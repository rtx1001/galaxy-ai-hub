export const INTERNAL_MEDIA_STATE_EVENT = "galaxy-internal-media-state";

export type InternalMediaState = {
  active: boolean;
};

const activeInternalMediaIds = new Set<string>();

export const setInternalMediaPlayback = (id: string, playing: boolean) => {
  if (playing) {
    activeInternalMediaIds.add(id);
  } else {
    activeInternalMediaIds.delete(id);
  }
  window.dispatchEvent(
    new CustomEvent<InternalMediaState>(INTERNAL_MEDIA_STATE_EVENT, {
      detail: { active: activeInternalMediaIds.size > 0 },
    }),
  );
};
