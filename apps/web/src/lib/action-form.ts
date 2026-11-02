/**
 * Server Action 结果与 RHF 表单之间的纯函数桥。
 * Plan(auth 试点)定义、Plan 2 所有表单模块消费的约定。
 */

/** Server Action 错误对象:form 级 + 任意字段级,值均为文案字符串。 */
export interface ActionErrors {
  form?: string;
  [field: string]: string | undefined;
}

/**
 * 把 ActionResult.errors 应用到 RHF 表单:字段错误 → setError(name, { message }),
 * form 错误 → onFormError(message)。返回 true 表示有错误被应用(调用方据此跳过导航)。
 */
export function applyActionErrors(
  errors: ActionErrors,
  apply: {
    setFieldError(name: string, message: string): void;
    onFormError(message: string): void;
  },
): boolean {
  let applied = false;
  for (const [name, message] of Object.entries(errors)) {
    if (name === "form" || message === undefined) continue;
    apply.setFieldError(name, message);
    applied = true;
  }
  if (errors.form !== undefined) {
    apply.onFormError(errors.form);
    applied = true;
  }
  return applied;
}
