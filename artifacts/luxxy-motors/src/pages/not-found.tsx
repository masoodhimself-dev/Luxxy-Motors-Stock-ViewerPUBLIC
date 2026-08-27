import { AlertCircle, FileQuestion } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto">
          <FileQuestion className="w-10 h-10 text-muted-foreground" />
        </div>
        
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Page not found
          </h1>
          <p className="text-muted-foreground">
            We couldn't find the vehicle or page you were looking for. It may have been sold or removed.
          </p>
        </div>

        <Button asChild size="lg" className="w-full">
          <Link href="/">Back to Showroom</Link>
        </Button>
      </div>
    </div>
  );
}
