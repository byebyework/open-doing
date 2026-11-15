"use client";

import type { VirtualMember } from "@open-doing/types";
import { BotIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Alert } from "@/components/ui/shadcn/alert";
import { Badge } from "@/components/ui/shadcn/badge";
import { Button } from "@/components/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/shadcn/dialog";
import { Input } from "@/components/ui/shadcn/input";
import { Label } from "@/components/ui/shadcn/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/shadcn/select";
import { Textarea } from "@/components/ui/shadcn/textarea";
import { cn } from "@/lib/utils";

import { NAME_MAX_LENGTH } from "../../constants";
import {
  createVirtualMemberAction,
  removeVirtualMemberAction,
  updateVirtualMemberAction,
} from "../actions";

/**
 * 头像色四色调色板：仓库有意未收录为 token 的字面色，
 * 与任务优先级 / 状态色同属「无 token 但有既定语义」的一组。
 */
const ACCENT_COLORS = ["#a66b00", "#0b6fb8", "#0e9ba3", "#9b87f5"] as const;
const DEFAULT_ACCENT_COLOR = ACCENT_COLORS[0];

type VirtualMemberRole = VirtualMember["role"];

export interface VirtualMemberManagerProps {
  teamSlug: string;
  /** 服务端读取的本团队虚拟成员（可序列化领域对象）。 */
  members: VirtualMember[];
}

interface FieldErrors {
  name?: string;
  role?: string;
}

interface MemberFormDialogProps {
  teamSlug: string;
  open: boolean;
  /** null = 新建；否则为正在编辑的虚拟成员。 */
  member: VirtualMember | null;
  onCancel: () => void;
  onSaved: () => void;
}

/**
 * 新建 / 编辑虚拟成员弹窗（同一表单复用）。
 *
 * 提交成功 → toast → `router.refresh()` → 关闭弹窗；失败时字段错误落在
 * 名称 / 角色下方，表单级错误显示在顶部，弹窗保持。退出保持窗口内内容
 * 仍可交互，提交处理按 `!open || loading` 幂等闸门防双发；loading 期间
 * 取消与 Esc / 关闭钮均被忽略。
 */
function MemberFormDialog({
  teamSlug,
  open,
  member,
  onCancel,
  onSaved,
}: MemberFormDialogProps) {
  const router = useRouter();
  const t = useTranslations("teams.virtualMembers");
  const tTeams = useTranslations("teams");
  const tCommon = useTranslations("common");

  const [name, setName] = useState("");
  const [role, setRole] = useState<VirtualMemberRole>("member");
  const [description, setDescription] = useState("");
  const [accentColor, setAccentColor] = useState<string>(DEFAULT_ACCENT_COLOR);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  // 每次打开都重置为当前编辑对象（关闭期间内容被卸载，但组件状态常驻）。
  // 走仓库既有的「渲染期同步 props→state」模式，避免 effect 内级联 setState。
  const [syncedDialog, setSyncedDialog] = useState<{
    open: boolean;
    member: VirtualMember | null;
  }>({ open, member });
  if (syncedDialog.open !== open || syncedDialog.member !== member) {
    setSyncedDialog({ open, member });
    if (open) {
      setName(member?.name ?? "");
      setRole(member?.role ?? "member");
      setDescription(member?.description ?? "");
      setAccentColor(member?.accentColor ?? DEFAULT_ACCENT_COLOR);
      setFieldErrors({});
      setFormError(null);
      setLoading(false);
    }
  }

  function close(): void {
    if (loading) return;
    onCancel();
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    // 成功分支会关闭弹窗，但内容在退出保持窗口内仍可交互；迟到的回车 /
    // 点击可能再次提交，这里按 !open || loading 忽略。
    if (!open || loading) return;

    setLoading(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const payload = {
        teamSlug,
        name: name.trim(),
        role,
        description: description.trim(),
        accentColor,
      };
      const result = member
        ? await updateVirtualMemberAction({ ...payload, virtualMemberId: member.id })
        : await createVirtualMemberAction(payload);

      if (!result.ok) {
        const nextFieldErrors: FieldErrors = {};
        if (result.errors.name) nextFieldErrors.name = result.errors.name;
        if (result.errors.role) nextFieldErrors.role = result.errors.role;
        setFieldErrors(nextFieldErrors);

        if (result.errors.form) {
          setFormError(result.errors.form);
        } else if (!nextFieldErrors.name && !nextFieldErrors.role) {
          setFormError(
            tTeams(member ? "updateVirtualMemberFailed" : "createVirtualMemberFailed"),
          );
        }
        return;
      }

      toast.success(member ? t("updated") : t("created"));
      router.refresh();
      onSaved();
    } catch {
      setFormError(tCommon("networkError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{member ? t("editTitle") : t("addTitle")}</DialogTitle>
        </DialogHeader>

        {formError ? (
          <Alert
            variant="destructive"
            role="alert"
            className="mb-4"
            data-testid="virtual-member-form-error"
          >
            {formError}
          </Alert>
        ) : null}

        <form onSubmit={submit} noValidate>
          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="virtual-member-name">{t("fields.name")}</Label>
            <Input
              id="virtual-member-name"
              type="text"
              data-testid="virtual-member-name-input"
              placeholder={t("namePlaceholder")}
              maxLength={NAME_MAX_LENGTH}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={
                fieldErrors.name ? "virtual-member-name-error" : undefined
              }
              disabled={loading}
              autoFocus
            />
            {fieldErrors.name ? (
              <p
                id="virtual-member-name-error"
                data-testid="virtual-member-name-error"
                className="text-[12.5px] text-[var(--error)]"
              >
                {fieldErrors.name}
              </p>
            ) : null}
          </div>

          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="virtual-member-role">{t("fields.role")}</Label>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as VirtualMemberRole)}
              disabled={loading}
            >
              <SelectTrigger
                id="virtual-member-role"
                data-testid="virtual-member-role-select"
                className="w-full"
                aria-invalid={fieldErrors.role ? true : undefined}
                aria-describedby={
                  fieldErrors.role ? "virtual-member-role-error" : undefined
                }
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">{t("roleAdmin")}</SelectItem>
                <SelectItem value="member">{t("roleMember")}</SelectItem>
              </SelectContent>
            </Select>
            {fieldErrors.role ? (
              <p
                id="virtual-member-role-error"
                data-testid="virtual-member-role-error"
                className="text-[12.5px] text-[var(--error)]"
              >
                {fieldErrors.role}
              </p>
            ) : null}
          </div>

          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="virtual-member-description">{t("fields.description")}</Label>
            <Textarea
              id="virtual-member-description"
              data-testid="virtual-member-description-input"
              rows={3}
              placeholder={t("descriptionPlaceholder")}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={loading}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t("fields.accentColor")}</span>
            <div className="flex items-center gap-2">
              {ACCENT_COLORS.map((color, index) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`${t("fields.accentColor")} ${index + 1}`}
                  aria-pressed={accentColor === color}
                  data-testid={`virtual-member-accent-${index}`}
                  disabled={loading}
                  onClick={() => setAccentColor(color)}
                  className={cn(
                    "size-7 rounded-full border-2 transition-transform",
                    accentColor === color
                      ? "scale-110 border-[var(--ink-900)]"
                      : "border-transparent",
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              data-testid="virtual-member-cancel"
              disabled={loading}
              onClick={close}
            >
              {tCommon("cancel")}
            </Button>
            <Button type="submit" data-testid="virtual-member-submit" disabled={loading}>
              {loading ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
              {member ? t("save") : t("add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 虚拟团队设置页的虚拟成员管理（列表 + 新建 / 编辑 / 移除）。
 *
 * 只列出虚拟成员；真人 owner 行由既有 `MemberList` 只读展示，不在此重复。
 * 列表数据来自 RSC，`router.refresh()` 后按「sync props → state during
 * render」模式与最新 props 对齐；移除确认走 ConfirmModal（不自动关闭，
 * 成功分支才关闭）。
 */
export function VirtualMemberManager({ teamSlug, members }: VirtualMemberManagerProps) {
  const router = useRouter();
  const t = useTranslations("teams.virtualMembers");
  const tTeams = useTranslations("teams");
  const tCommon = useTranslations("common");

  // RSC 数据经 router.refresh() 更新：渲染期与最新 props 对齐。
  const [syncedMembers, setSyncedMembers] = useState<VirtualMember[]>(members);
  if (members !== syncedMembers) {
    setSyncedMembers(members);
  }

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VirtualMember | null>(null);
  const [removing, setRemoving] = useState<VirtualMember | null>(null);
  const [removingLoading, setRemovingLoading] = useState(false);

  function openCreate(): void {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(member: VirtualMember): void {
    setEditing(member);
    setDialogOpen(true);
  }

  function closeDialog(): void {
    setDialogOpen(false);
  }

  async function confirmRemove(): Promise<void> {
    if (!removing || removingLoading) return;

    setRemovingLoading(true);

    try {
      const result = await removeVirtualMemberAction({
        teamSlug,
        virtualMemberId: removing.id,
      });

      if (!result.ok) {
        toast.error(result.errors.form ?? tTeams("removeVirtualMemberFailed"));
        return;
      }

      toast.success(t("removed"));
      router.refresh();
      // ConfirmModal 不自动关闭：仅成功分支关闭，失败保持弹窗。
      setRemoving(null);
    } catch {
      toast.error(tCommon("networkError"));
    } finally {
      setRemovingLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-[var(--ink-900)]">{t("listTitle")}</h2>
          <p className="mt-1 text-[13px] text-[var(--ink-400)]">{t("listSubtitle")}</p>
        </div>
        <Button type="button" data-testid="add-virtual-member" onClick={openCreate}>
          <PlusIcon aria-hidden="true" />
          {t("add")}
        </Button>
      </div>

      {syncedMembers.length === 0 ? (
        <div className="rounded-[var(--radius-8)] border border-dashed border-[#eceef0] px-4 py-6 text-center">
          <p className="text-[13px] font-medium text-[var(--ink-900)]">{t("empty")}</p>
          <p className="mt-1 text-[12px] text-[var(--ink-400)]">{t("emptyHint")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {syncedMembers.map((member) => (
            <li
              key={member.id}
              data-testid={`virtual-member-${member.id}`}
              className="flex min-w-0 items-start gap-3 rounded-[var(--radius-8)] border border-[#eceef0] px-3 py-2.5"
            >
              <span className="relative flex-none">
                <span
                  className="grid size-9 place-items-center rounded-full text-[13px] font-semibold text-white"
                  style={{ backgroundColor: member.accentColor ?? DEFAULT_ACCENT_COLOR }}
                  aria-hidden="true"
                >
                  {[...member.name.trim()][0] ?? ""}
                </span>
                <span
                  data-testid={`virtual-member-bot-badge-${member.id}`}
                  className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-[var(--ink-900)] text-white"
                  aria-hidden="true"
                >
                  <BotIcon className="size-2.5" />
                </span>
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-[var(--ink-900)]">
                    {member.name}
                  </span>
                  <Badge
                    variant={member.role === "admin" ? "info" : "neutral"}
                    className="rounded-[var(--radius-pill)] px-2 py-0 text-[12px] font-medium leading-5"
                  >
                    {member.role === "admin" ? t("roleAdmin") : t("roleMember")}
                  </Badge>
                </div>
                {member.description ? (
                  <p className="mt-0.5 text-[12px] text-[var(--ink-400)]">
                    {member.description}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-none items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t("editAria", { name: member.name })}
                  data-testid={`edit-virtual-member-${member.id}`}
                  onClick={() => openEdit(member)}
                >
                  <PencilIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t("removeAria", { name: member.name })}
                  data-testid={`remove-virtual-member-${member.id}`}
                  onClick={() => setRemoving(member)}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <MemberFormDialog
        teamSlug={teamSlug}
        open={dialogOpen}
        member={editing}
        onCancel={closeDialog}
        onSaved={closeDialog}
      />

      <ConfirmModal
        open={removing !== null}
        title={t("removeConfirmTitle")}
        content={<p>{t("removeConfirmDescription", { name: removing?.name ?? "" })}</p>}
        confirmText={t("remove")}
        danger
        loading={removingLoading}
        okButtonProps={{ "data-testid": "confirm-remove-virtual-member" }}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
