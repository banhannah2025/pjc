self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    console.error("OUGM push payload parse failed.", error);
  }

  const isOnDuty =
    data.is_on_duty === true ||
    data.isOnDuty === true ||
    data.is_on_duty === "true";

  if (!isOnDuty) {
    return;
  }

  const body =
    typeof data.text === "string" && data.text.length > 0
      ? data.text
      : "New OUGM security dispatch.";

  event.waitUntil(
    self.registration.showNotification("OUGM Security Dispatch", {
      body,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      data: {
        url: typeof data.url === "string" ? data.url : "/chat",
      },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/chat";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(
      (clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }

        return undefined;
      }
    )
  );
});
