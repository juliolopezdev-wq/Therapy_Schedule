import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export function MyProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const { therapistId } = usePermissions();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const therapistsQuery = trpc.therapists.list.useQuery(undefined, {
    enabled: open && therapistId != null,
  });
  const mine = therapistsQuery.data?.find(t => t.id === therapistId);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (open) {
      setEmail(mine?.email ?? "");
      setPhone(mine?.phone ?? "");
    }
  }, [open, mine?.id, mine?.email, mine?.phone]);

  useEffect(() => {
    if (open) setName(user?.name ?? "");
  }, [open, user?.name]);

  const updateName = trpc.auth.updateOwnName.useMutation();
  const updateContact = trpc.therapists.updateOwnContact.useMutation();
  const save = async () => {
    setSaving(true);
    try {
      if (name.trim() !== (user?.name ?? "").trim()) {
        await updateName.mutateAsync({ name: name.trim() });
        await utils.auth.me.invalidate();
        utils.admin.listUsers.invalidate();
      }
      if (
        mine &&
        (email.trim() !== (mine.email ?? "") ||
          phone.trim() !== (mine.phone ?? ""))
      ) {
        await updateContact.mutateAsync({
          email: email.trim() || null,
          phone: phone.trim() || null,
        });
        await utils.therapists.list.invalidate();
      }
      toast.success("Your profile was updated");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Your profile could not be saved"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>My profile</DialogTitle>
          <DialogDescription>
            Add or change your account name. You can also leave it blank.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="my-name">Name (optional)</Label>
            <Input
              id="my-name"
              autoComplete="name"
              maxLength={80}
              className="mt-1 h-10"
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="Your name"
            />
          </div>
          <p className="break-all text-sm text-muted-foreground">
            Sign-in email: {user?.email}
          </p>
          {therapistId != null && therapistsQuery.isLoading && (
            <p className="text-sm text-muted-foreground">
              Loading staff contact details…
            </p>
          )}
          {therapistId != null && therapistsQuery.isError && (
            <p role="alert" className="text-sm text-destructive">
              Staff contact details could not be loaded. Your account name can
              still be saved.
            </p>
          )}
          {mine && (
            <>
              <p className="text-xs text-muted-foreground">
                Staff contact details. Changing these does not change your
                sign-in email.
              </p>
              <div>
                <Label htmlFor="my-email">Staff contact email</Label>
                <Input
                  id="my-email"
                  type="email"
                  className="mt-1 h-10"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>
              <div>
                <Label htmlFor="my-phone">Phone</Label>
                <Input
                  id="my-phone"
                  type="tel"
                  className="mt-1 h-10"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="(555) 555-5555"
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={save}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
