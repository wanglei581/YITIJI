import { MyNotificationsPage } from '../profile/me/MyNotificationsPage'

/** Alias route — reuses canonical member notifications capability (Scheme B: no second data source). */
export default function NotificationsPage() {
  return <MyNotificationsPage loginFrom="/notifications" />
}
