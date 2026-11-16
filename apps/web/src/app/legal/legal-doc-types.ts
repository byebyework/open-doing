/** 法律文档展示组件的入参形状（zh/en 共用；sections 由消息包数组映射而来）。 */
export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocProps {
  title: string;
  /** 版本标签文案（如「版本」/「Version」）；version 值来自 AGREEMENT_VERSION 常量。 */
  versionLabel: string;
  version: string;
  effectiveLabel: string;
  effectiveDate: string;
  intro: string;
  sections: LegalSection[];
}
