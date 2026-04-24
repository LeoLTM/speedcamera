import { useTheme } from "next-themes";
import { HugeiconsIcon } from "@hugeicons/react";
import { Sun01Icon, Moon01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();

  const toggle = () => setTheme(resolvedTheme === "dark" ? "light" : "dark");

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-8", className)}
      onClick={toggle}
      aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {resolvedTheme === "dark"
        ? <HugeiconsIcon icon={Sun01Icon} strokeWidth={2} className="size-4" />
        : <HugeiconsIcon icon={Moon01Icon} strokeWidth={2} className="size-4" />}
    </Button>
  );
}
