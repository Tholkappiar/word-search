import {
  GameCommandSchema,
  NormalizedChatEventSchema,
  NormalizedSubscriberEventSchema,
  type GameCommand,
  type NormalizedChatEvent,
  type NormalizedSubscriberEvent
} from "./index.js";

/** A delivery targets one immutable session, never whichever stream is current later. */
export type GameCommandTarget = Pick<GameCommand, "streamId" | "deploymentId" | "runtimeInstanceId">;

function scopedEvent<T extends { streamId: string; deploymentId?: string | undefined; runtimeInstanceId?: string | undefined }>(event: T, target: GameCommandTarget): T & GameCommandTarget {
  if (event.streamId !== target.streamId ||
      (event.deploymentId !== undefined && event.deploymentId !== target.deploymentId) ||
      (event.runtimeInstanceId !== undefined && event.runtimeInstanceId !== target.runtimeInstanceId)) {
    throw new Error("Game event does not belong to the target session");
  }
  return { ...event, streamId: target.streamId, deploymentId: target.deploymentId, runtimeInstanceId: target.runtimeInstanceId };
}

function eventCommandId(kind: string, eventId: string, target: GameCommandTarget) {
  return `event:${kind}:${encodeURIComponent(target.runtimeInstanceId)}:${encodeURIComponent(eventId)}`;
}

/** Shared by live ingestion and the local simulator. Re-delivery keeps its ID. */
export function chatEventToGameCommand(event: NormalizedChatEvent, target: GameCommandTarget, issuedAt = event.receivedAt): GameCommand {
  const chatEvent = scopedEvent(NormalizedChatEventSchema.parse(event), target);
  return GameCommandSchema.parse({
    streamId: target.streamId, deploymentId: target.deploymentId, runtimeInstanceId: target.runtimeInstanceId,
    commandId: eventCommandId("chat", chatEvent.eventId, target),
    issuedBy: "orchestrator:chat",
    issuedAt,
    type: "injectChatEvent",
    payload: { chatEvent },
    requireAck: true
  });
}

export function subscriberEventToGameCommand(event: NormalizedSubscriberEvent, target: GameCommandTarget, issuedAt = event.receivedAt): GameCommand {
  const subscriberEvent = scopedEvent(NormalizedSubscriberEventSchema.parse(event), target);
  return GameCommandSchema.parse({
    streamId: target.streamId, deploymentId: target.deploymentId, runtimeInstanceId: target.runtimeInstanceId,
    commandId: eventCommandId("subscriber", subscriberEvent.eventId, target),
    issuedBy: "orchestrator:subscriber-ingestion",
    issuedAt,
    type: "injectSubscriberEvent",
    payload: { subscriberEvent },
    requireAck: true
  });
}
