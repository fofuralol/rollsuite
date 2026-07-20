// rollsuite-updater
// Usage:
//   updater.exe --pid <pid> --zip <path\to.zip> --install <install-dir> --exe RollsSuite.exe [--version <v>] [--log <path>]
//
// Waits for the parent PID to exit, extracts the zip to a staging folder,
// copies everything over the install dir (with retry against file locks),
// writes native-version.txt and launches the new exe. Windows GUI subsystem
// so it never flashes a console window.
package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

var logFile *os.File

func logf(format string, a ...any) {
	line := fmt.Sprintf("["+time.Now().Format("2006-01-02 15:04:05")+"] "+format+"\n", a...)
	if logFile != nil {
		logFile.WriteString(line)
	}
}

func fatal(exePath string, err error) {
	logf("FATAL: %v", err)
	if exePath != "" {
		_ = launchDetached(exePath)
	}
	os.Exit(1)
}

func main() {
	pidFlag := flag.Int("pid", 0, "PID to wait for exit")
	zipFlag := flag.String("zip", "", "Path to update zip")
	installFlag := flag.String("install", "", "Install directory (contains the running exe)")
	exeFlag := flag.String("exe", "RollsSuite.exe", "Main exe filename")
	versionFlag := flag.String("version", "", "Version string to write to native-version.txt")
	logFlag := flag.String("log", "", "Log file path (defaults to <install>/native-update-error.log)")
	legacyFlag := flag.String("legacy", "", "Comma-separated legacy exe filenames to remove after swap")
	flag.Parse()

	if *installFlag == "" || *zipFlag == "" {
		fmt.Fprintln(os.Stderr, "missing --install or --zip")
		os.Exit(2)
	}
	install := *installFlag
	exeName := *exeFlag
	exePath := filepath.Join(install, exeName)

	logPath := *logFlag
	if logPath == "" {
		logPath = filepath.Join(install, "native-update-error.log")
	}
	if f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644); err == nil {
		logFile = f
		defer f.Close()
	}
	logf("updater start pid=%d zip=%s install=%s", *pidFlag, *zipFlag, install)

	if *pidFlag > 0 {
		waitForExit(*pidFlag, 60*time.Second)
	}
	time.Sleep(500 * time.Millisecond)

	staging := filepath.Join(install, "native-staging")
	_ = os.RemoveAll(staging)
	if err := os.MkdirAll(staging, 0755); err != nil {
		fatal(exePath, fmt.Errorf("mkdir staging: %w", err))
	}

	if err := unzip(*zipFlag, staging); err != nil {
		fatal(exePath, fmt.Errorf("unzip: %w", err))
	}

	src := staging
	if _, err := os.Stat(filepath.Join(src, exeName)); errors.Is(err, os.ErrNotExist) {
		entries, _ := os.ReadDir(staging)
		var onlyDir string
		dirCount := 0
		for _, e := range entries {
			if e.IsDir() {
				dirCount++
				onlyDir = e.Name()
			}
		}
		if dirCount == 1 {
			src = filepath.Join(staging, onlyDir)
		}
	}
	if _, err := os.Stat(filepath.Join(src, exeName)); err != nil {
		fatal(exePath, fmt.Errorf("%s não encontrado no pacote", exeName))
	}

	// Retry copy against transient locks (AV, tail-writes from parent exit).
	var copyErr error
	for i := 0; i < 40; i++ {
		copyErr = copyTree(src, install)
		if copyErr == nil {
			hash1, e1 := sha256File(filepath.Join(src, exeName))
			hash2, e2 := sha256File(exePath)
			if e1 == nil && e2 == nil && hash1 == hash2 {
				break
			}
			copyErr = fmt.Errorf("hash mismatch after copy")
		}
		time.Sleep(750 * time.Millisecond)
	}
	if copyErr != nil {
		fatal(exePath, fmt.Errorf("copy: %w", copyErr))
	}

	if *legacyFlag != "" {
		for _, name := range strings.Split(*legacyFlag, ",") {
			name = strings.TrimSpace(name)
			if name == "" || name == exeName {
				continue
			}
			_ = os.Remove(filepath.Join(install, name))
		}
	}

	if *versionFlag != "" {
		_ = os.WriteFile(filepath.Join(install, "native-version.txt"), []byte(*versionFlag), 0644)
	}

	_ = os.RemoveAll(staging)
	_ = os.Remove(*zipFlag)

	logf("swap OK, launching %s", exePath)
	if err := launchDetached(exePath); err != nil {
		logf("launch error: %v", err)
	}
}

func waitForExit(pid int, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !processAlive(pid) {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func processAlive(pid int) bool {
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	if runtime.GOOS == "windows" {
		// On Windows, FindProcess opens a handle; Signal(0) tests it.
		err := p.Signal(syscall.Signal(0))
		return err == nil
	}
	return p.Signal(syscall.Signal(0)) == nil
}

func unzip(zipPath, dest string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, f := range r.File {
		fp := filepath.Join(dest, f.Name)
		if !strings.HasPrefix(fp, filepath.Clean(dest)+string(os.PathSeparator)) && fp != filepath.Clean(dest) {
			return fmt.Errorf("zip path escapes: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			os.MkdirAll(fp, 0755)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(fp), 0755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(fp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			rc.Close()
			return err
		}
		if _, err := io.Copy(out, rc); err != nil {
			rc.Close()
			out.Close()
			return err
		}
		rc.Close()
		out.Close()
	}
	return nil
}

func copyTree(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		return copyFile(path, target)
	})
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	// Try direct write; if the destination is locked, write to a tmp and rename.
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		tmp := dst + ".upd-tmp"
		out2, err2 := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
		if err2 != nil {
			return err
		}
		if _, err2 := io.Copy(out2, in); err2 != nil {
			out2.Close()
			os.Remove(tmp)
			return err2
		}
		out2.Close()
		if err2 := os.Rename(tmp, dst); err2 != nil {
			os.Remove(tmp)
			return err2
		}
		return nil
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func launchDetached(exePath string) error {
	cmd := exec.Command(exePath)
	cmd.Dir = filepath.Dir(exePath)
	// Detach so this updater can exit immediately.
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000008 | 0x00000200} // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
	}
	return cmd.Start()
}
