import { BillWorkspace } from "@/components/bill-workspace";
import { requiresRegisteredRestaurant } from "@/lib/access-policy";

export const dynamic = "force-dynamic";

export default function Home() {
  return <BillWorkspace requireRestaurant={requiresRegisteredRestaurant()} />;
}
