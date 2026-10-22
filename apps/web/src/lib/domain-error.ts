/**
 * 全仓通用领域错误。
 *
 * service 层只抛出该错误（或其后代）表达可预期的业务失败；
 * Server Action 层统一捕获并按 `field` 映射为表单字段错误：
 * `{ [field ?? "form"]: message }`。
 *
 * 未知错误不得把数据库 / 内部细节透传给客户端，由 action 层兜底为通用文案。
 */
export class DomainError extends Error {
  /**
   * 表单字段名（如 `name`、`description`）；缺省表示整个表单级错误。
   */
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "DomainError";
    this.field = field;
  }
}
