import { redirect } from "next/navigation";

// The old address of the sample venue. Kept so earlier links still work.
export default function DemoRedirect() {
  redirect("/sample");
}
