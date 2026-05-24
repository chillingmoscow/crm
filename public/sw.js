/* Service worker для Web Push. Отдаётся статикой из /public.
 * Регистрируется клиентом (см. use-push-subscription). Показывает
 * нативную плашку из payload'а диспетчера и открывает link по клику.
 */

self.addEventListener("install", () => {
  // Не ждём закрытия старых вкладок — новый SW активируется сразу.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Берём контроль над уже открытыми вкладками без перезагрузки.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "Уведомление" };
  }

  const title = data.title || "Уведомление";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon.svg",
    badge: "/icon.svg",
    // tag: схлопывает дубль-уведомления одной сущности (если передан).
    tag: data.tag || undefined,
    data: { link: data.link || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Если приложение уже открыто — фокусируем и навигируем туда.
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client && link) {
              client.navigate(link).catch(() => {});
            }
            return;
          }
        }
        // Иначе открываем новое окно.
        if (self.clients.openWindow) {
          return self.clients.openWindow(link);
        }
      }),
  );
});
