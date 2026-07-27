import { useNavigate } from "react-router";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { DEMO_GROUPS, demoSearchValue } from "@/lib/demo-catalog";

type DemoSearchPopupProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
};

/**
 * cmdk command palette over the app's demo catalog. Opened either by
 * Cmd/Ctrl+K or by the agent's `open_search_popup` frontend tool, which can
 * also prefill the query. Selecting a demo navigates to it.
 *
 * Filtering here is cmdk's own built-in fuzzy filter (via each CommandItem's
 * `value`) — the separate `searchDemos()` scorer in `@/lib/demo-catalog` is
 * for the agent-facing `search_demos` tool only. Mixing the two (pre-filtering
 * the list AND leaving cmdk's filter on) would double-narrow into empty
 * results, so don't.
 */
export function DemoSearchPopup({
  open,
  onOpenChange,
  query,
  onQueryChange,
}: DemoSearchPopupProps) {
  const navigate = useNavigate();

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search demos"
      description="Search the UI Dojo demo catalog"
      className="sm:max-w-2xl"
    >
      <CommandInput
        placeholder="Search demos..."
        value={query}
        onValueChange={onQueryChange}
      />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>No demos found.</CommandEmpty>
        {DEMO_GROUPS.map(({ group, demos }) => (
          <CommandGroup key={group} heading={group}>
            {demos.map((demo) => (
              <CommandItem
                key={demo.id}
                // cmdk filters + dedupes on `value`; include every searchable
                // field so typing "workflow" or "suspend" both hit, and the id
                // so no two items (several share a title) collide.
                value={demoSearchValue(demo)}
                onSelect={() => {
                  onOpenChange(false);
                  navigate(demo.url);
                }}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate">{demo.title}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {demo.description}
                  </span>
                </div>
                {demo.concept ? (
                  <CommandShortcut>{demo.concept}</CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
