import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn/ui 标准类名合并工具(cn + tailwind-merge)。
 * vendored 组件一律经此合并外部 className,保证覆盖语义与官方一致。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
