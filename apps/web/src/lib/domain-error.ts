/**
 * 全仓通用领域错误。
 *
 * service 层只抛出该错误（或其后代）表达可预期的业务失败；
 * Server Action 层统一捕获并按 `field` 映射为表单字段错误：
 * `{ [field ?? "form"]: message }`。
 *
 * 未知错误不得把数据库 / 内部细节透传给客户端，由 action 层兜底为通用文案。
 */
/** i18n 翻译描述:action 层用请求 locale 把 key 翻成用户可见文案。 */
export interface DomainErrorI18n {
  /** messages JSON 中的 key(如 `errors.forbidden`)。 */
  key: string;
  /** 模板插值参数(如 `{ max: 200 }`)。 */
  params?: Record<string, string | number>;
}

export class DomainError extends Error {
  /**
   * 表单字段名（如 `name`、`description`）；缺省表示整个表单级错误。
   */
  readonly field?: string;

  /**
   * i18n 描述（可选,渐进迁移通道）：存在时 action 层优先用 key+params
   * 翻译,忽略 message（message 此时仅为日志用）；缺省时沿用 message,
   * 存量 `new DomainError(message, field?)` 调用全部继续合法。
   */
  readonly i18n?: DomainErrorI18n;

  constructor(message: string, field?: string, i18n?: DomainErrorI18n) {
    super(message);
    this.name = "DomainError";
    this.field = field;
    this.i18n = i18n;
  }
}
