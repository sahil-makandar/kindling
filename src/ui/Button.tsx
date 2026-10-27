import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "cta" | "secondary";

// Ink text on ember (6.3:1) passes AA; cream text on ember (2.9:1) does not.
const variants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-card",
  cta: "bg-tomato text-ink",
  secondary: "bg-transparent text-ink",
};

const base =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-md border-2 border-ink px-5 py-2 " +
  "font-bold no-underline shadow-hard transition-[transform,box-shadow] duration-150 " +
  "hover:-translate-x-px hover:-translate-y-px " +
  "active:translate-x-[3px] active:translate-y-[3px] active:scale-[0.97] active:shadow-none " +
  "focus-visible:shadow-[3px_3px_0_0_var(--color-ink),0_0_0_2px_var(--color-ink)] " +
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none";

export function buttonClasses(variant: ButtonVariant = "primary", extra?: string): string {
  return cx(base, variants[variant], extra);
}

type CommonProps = {
  variant?: ButtonVariant;
  children: ReactNode;
  className?: string;
};

type ButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
    href?: undefined;
  };

type LinkProps = CommonProps & { href: string };

export function Button(props: ButtonProps | LinkProps) {
  if (props.href !== undefined) {
    const { variant, className, children, href } = props;
    return (
      <Link href={href} className={buttonClasses(variant, className)}>
        {children}
      </Link>
    );
  }
  const { variant, className, children, type = "button", ...rest } = props;
  return (
    <button type={type} className={buttonClasses(variant, className)} {...rest}>
      {children}
    </button>
  );
}
