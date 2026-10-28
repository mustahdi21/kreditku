/**
 * overlay.tsx — Komponen lapisan atas: dialog, drawer (sheet), alert dialog,
 * dropdown, popover, tooltip, tab, dan accordion.
 *
 * Seluruh komponen dibangun di atas Radix UI sehingga navigasi keyboard,
 * manajemen fokus, dan atribut ARIA sudah benar sejak awal.
 */

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/base';

/* -------------------------------------------------------------------------- */
/* Dialog                                                                     */
/* -------------------------------------------------------------------------- */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { size?: 'sm' | 'default' | 'lg' | 'xl' }
>(({ className, children, size = 'default', ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 grid max-h-[92vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border bg-background p-5 shadow-lg',
        size === 'sm' && 'max-w-md',
        size === 'default' && 'max-w-xl',
        size === 'lg' && 'max-w-3xl',
        size === 'xl' && 'max-w-5xl',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Tutup"
      >
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

export function DialogHeader({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return <div className={cn('flex flex-col space-y-1.5 pr-8 text-left', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>): JSX.Element {
  return <DialogPrimitive.Title className={cn('text-lg font-semibold', className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>): JSX.Element {
  return <DialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Sheet (drawer untuk mobile)                                                */
/* -------------------------------------------------------------------------- */

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;

export const SheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { side?: 'left' | 'right' | 'bottom' }
>(({ className, children, side = 'left', ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed z-50 flex flex-col gap-4 bg-background p-5 shadow-lg',
        side === 'left' && 'inset-y-0 left-0 w-80 max-w-[85vw] border-r',
        side === 'right' && 'inset-y-0 right-0 w-96 max-w-[90vw] border-l',
        side === 'bottom' && 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-xl border-t',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Tutup"
      >
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = 'SheetContent';

/* -------------------------------------------------------------------------- */
/* Alert dialog (konfirmasi tindakan penting)                                 */
/* -------------------------------------------------------------------------- */

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export function AlertDialogContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>): JSX.Element {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
      <AlertDialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-5 shadow-lg',
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogHeader({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return <div className={cn('space-y-1.5', className)} {...props} />;
}

export function AlertDialogFooter({ className, ...props }: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

export function AlertDialogTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>): JSX.Element {
  return <AlertDialogPrimitive.Title className={cn('text-lg font-semibold', className)} {...props} />;
}

export function AlertDialogDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>): JSX.Element {
  return <AlertDialogPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function AlertDialogAction({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>): JSX.Element {
  return (
    <AlertDialogPrimitive.Action
      className={cn('inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90', className)}
      {...props}
    />
  );
}

export function AlertDialogCancel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>): JSX.Element {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn('inline-flex h-10 items-center justify-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent', className)}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Dropdown menu                                                              */
/* -------------------------------------------------------------------------- */

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = 'end',
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>): JSX.Element {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 min-w-[12rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  inset,
  destructive,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { inset?: boolean; destructive?: boolean }): JSX.Element {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        inset && 'pl-8',
        destructive && 'text-destructive focus:bg-destructive/10 focus:text-destructive',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>): JSX.Element {
  return <DropdownMenuPrimitive.Label className={cn('px-2 py-1.5 text-xs font-semibold text-muted-foreground', className)} {...props} />;
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>): JSX.Element {
  return <DropdownMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Popover                                                                    */
/* -------------------------------------------------------------------------- */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>): JSX.Element {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn('z-50 w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/* -------------------------------------------------------------------------- */
/* Tooltip                                                                    */
/* -------------------------------------------------------------------------- */

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>): JSX.Element {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn('z-50 max-w-xs rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md', className)}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                       */
/* -------------------------------------------------------------------------- */

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>): JSX.Element {
  return (
    <TabsPrimitive.List
      className={cn('inline-flex h-10 items-center justify-start gap-1 rounded-lg bg-muted p-1 text-muted-foreground', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>): JSX.Element {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all',
        'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Content>): JSX.Element {
  return <TabsPrimitive.Content className={cn('mt-4', className)} {...props} />;
}

/* -------------------------------------------------------------------------- */
/* Accordion                                                                  */
/* -------------------------------------------------------------------------- */

export const Accordion = AccordionPrimitive.Root;

export function AccordionItem({ className, ...props }: ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>): JSX.Element {
  return <AccordionPrimitive.Item className={cn('border-b', className)} {...props} />;
}

export function AccordionTrigger({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>): JSX.Element {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn('flex flex-1 items-center justify-between py-3 text-left text-sm font-medium transition-all hover:underline', className)}
        {...props}
      >
        {children}
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 data-[state=open]:rotate-180" aria-hidden />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>): JSX.Element {
  return (
    <AccordionPrimitive.Content className={cn('overflow-hidden text-sm', className)} {...props}>
      <div className="pb-4 pt-0">{children}</div>
    </AccordionPrimitive.Content>
  );
}

/* -------------------------------------------------------------------------- */
/* Scroll area                                                                */
/* -------------------------------------------------------------------------- */

export function ScrollArea({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>): JSX.Element {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">{children}</ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar orientation="vertical" className="flex w-2 touch-none select-none p-0.5">
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

/* -------------------------------------------------------------------------- */
/* Dialog konfirmasi siap pakai                                               */
/* -------------------------------------------------------------------------- */

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}

/**
 * Dialog konfirmasi untuk tindakan penting (pembatalan, pembebasan denda,
 * pembatalan pembayaran). Selalu menjelaskan konsekuensinya.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Lanjutkan',
  cancelLabel = 'Batal',
  destructive = false,
  loading = false,
  onConfirm,
  children,
}: ConfirmDialogProps): JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            loading={loading}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
