import { SiteNavigation } from "@/components/site-navigation";
import { getUnreadNotificationCount } from "@/lib/notifications";
import { getSessionUser } from "@/lib/session";

export async function SiteHeader() {
  const user = await getSessionUser();
  const unreadCount = user ? await getUnreadNotificationCount(user.id) : 0;

  return (
    <SiteNavigation
      user={user ? { id: user.id, name: user.name, role: user.role } : null}
      unreadCount={unreadCount}
    />
  );
}
