"use client";

// Renders agent-generated A2UI v0.9 surfaces with the official React renderer.
// Button/card actions are routed to the shared ActionContext (voice WS or chat).

import { useEffect, useState } from "react";
import { MessageProcessor, type SurfaceModel } from "@a2ui/web_core/v0_9";
import { A2uiSurface, type ReactComponentImplementation } from "@a2ui/react/v0_9";
import { grantsCatalog } from "./catalog";
import { useUiAction } from "@/lib/actions";
import type { A2uiMessage } from "@/lib/types";

export function A2uiView({ messages }: { messages: A2uiMessage[] }) {
  const dispatch = useUiAction();
  const [surfaces, setSurfaces] = useState<SurfaceModel<ReactComponentImplementation>[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const processor = new MessageProcessor<ReactComponentImplementation>([grantsCatalog], (action) => {
      dispatch(action.name, (action.context as Record<string, unknown>) || {});
    });
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      processor.processMessages(messages as any);
      setSurfaces(Array.from(processor.model.surfacesMap.values()));
      setError(null);
    } catch (e) {
      console.error("A2UI render failed", e, messages);
      setError(e instanceof Error ? e.message : String(e));
      setSurfaces([]);
    }
  }, [messages, dispatch]);

  if (error) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">Couldn&apos;t render this view: {error}</div>;
  }
  return (
    <div className="a2ui-host space-y-5 animate-fade-in">
      {surfaces.map((s) => <A2uiSurface key={s.id} surface={s} />)}
    </div>
  );
}
