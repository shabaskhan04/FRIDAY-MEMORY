import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        success:
          "border-transparent bg-success/20 text-success border-success/30",
        warning:
          "border-transparent bg-warning/20 text-warning border-warning/30",
        outline: "text-foreground border-border",
        past: "border-transparent bg-blue-500/15 text-blue-400 border-blue-500/30",
        present: "border-transparent bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
        future: "border-transparent bg-purple-500/15 text-purple-400 border-purple-500/30",
        positive: "border-transparent bg-success/15 text-success border-success/30",
        negative: "border-transparent bg-destructive/15 text-destructive border-destructive/30",
        neutral: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
