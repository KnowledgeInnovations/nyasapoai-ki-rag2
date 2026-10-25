import { redirect } from 'next/navigation'

// Users is a Settings tab now (/settings/users). This stays so that an open
// tab, a bookmark or a link in an older email still arrives somewhere.
export default function UsersRedirect() {
  redirect('/settings/users')
}
