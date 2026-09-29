// SPDX-License-Identifier: AGPL-3.0-or-later
// /console/applications has no list of its own: the pipeline (C-06) is the application list.
import { redirect } from 'next/navigation';

export default function ApplicationsIndex() {
  redirect('/console/pipeline');
}
