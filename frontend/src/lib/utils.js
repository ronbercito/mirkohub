/**
 * Archivo: frontend/src/lib/utils.js
 * Función: Utilidad cn() para combinar clases Tailwind (clsx + tailwind-merge) usada por los componentes shadcn/ui.
 * Trabaja con: components/ui/*
 */
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
