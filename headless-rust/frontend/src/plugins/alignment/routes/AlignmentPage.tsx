import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

// ponytail: alignment merged into unified /setup hardware wizard
export function AlignmentPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate({ to: "/setup" });
  }, [navigate]);

  return null;
}
