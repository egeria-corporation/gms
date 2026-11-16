// SPDX-License-Identifier: AGPL-3.0-only
import { PaymentsCenter } from "./PaymentsCenter.tsx";
import { useFunderMessages } from "./i18n.ts";

export default function PaymentsDue() {
  useFunderMessages();
  return <PaymentsCenter view="due" />;
}
