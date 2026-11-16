"use client";

import type { NodeProps } from "@xyflow/react";

import type { RFNode } from "@/lib/followup/graph-mappers";
import { useT } from "@/hooks/i18n/useT";
import { NODE_VISUALS, describeNodeConfig } from "./nodeVisuals";
import { NodeCard } from "./NodeCard";

/** O nó `set_contact_field` no canvas — preenche um campo do contato. */
export function SetContactFieldNode({ id, data, selected }: NodeProps<RFNode>) {
  const t = useT();
  return (
    <NodeCard
      id={id}
      visual={NODE_VISUALS.set_contact_field}
      label={data.label}
      subtitle={describeNodeConfig("set_contact_field", data.config, t)}
      selected={selected}
      errors={data.errors}
    />
  );
}
