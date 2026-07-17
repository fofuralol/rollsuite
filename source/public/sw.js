// Service Worker para Web Push notifications
self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Nova mensagem", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "WhatsApp";
  const options = {
    body: data.body || "",
    icon: data.icon || "/placeholder.svg",
    badge: data.badge || "/placeholder.svg",
    tag: data.tag || "wa-task",
    renotify: true,
    requireInteraction: Boolean(data.requireInteraction),
    vibrate: [200, 100, 200, 100, 200],
    silent: false,
    data: { url: data.url || "/monitor" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/monitor";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
