import { redirect } from 'next/navigation'

// Training is a Settings tab now (/settings/training). This stays so that an
// open tab, a bookmark or a link in an older email still arrives somewhere.
export default function TrainingRedirect() {
  redirect('/settings/training')
}
