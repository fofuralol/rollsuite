// License gate bypassed — always show app.
(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const g = document.getElementById("licenseGate"); if (g) g.style.display = "none";
    const w = document.getElementById("appWrap"); if (w) w.style.display = "";
  });
})();
