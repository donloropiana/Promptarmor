import { ShieldCheckIcon } from "lucide-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Temporary placeholder until the review queue lands; also smoke-tests the
// shadcn theme, Geist font, and lucide icons in production builds.
export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <ShieldCheckIcon className="size-6 text-muted-foreground" />
          <CardTitle>Marketing Compliance Workbench</CardTitle>
          <CardDescription>
            AI-assisted compliance review for marketing materials. Under
            construction.
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
