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
import { usePermissions } from "@/_core/hooks/usePermissions";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export function MyProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const utils = trpc.useUtils();
  const { therapistId } = usePermissions();
  const therapistsQuery = trpc.therapists.list.useQuery(undefined, { enabled: open });
  const mine = therapistsQuery.data?.find((t) => t.id === therapistId);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (open) { setEmail(mine?.email ?? ""); setPhone(mine?.phone ?? ""); }
  }, [open, mine?.id, mine?.email, mine?.phone]);

  const update = trpc.therapists.updateOwnContact.useMutation({
    onSuccess: () => { toast.success("Your contact info was updated"); utils.therapists.list.invalidate(); onOpenChange(false); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>My profile</DialogTitle>
          <DialogDescription>Keep your contact info up to date -- no need to wait on a team lead or admin.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label htmlFor="my-email">Email</Label><Input id="my-email" type="email" className="mt-1 h-10" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></div>
          <div><Label htmlFor="my-phone">Phone</Label><Input id="my-phone" type="tel" className="mt-1 h-10" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={update.isPending}
            onClick={() => update.mutate({ email: email.trim() || null, phone: phone.trim() || null })}
          >
            {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
