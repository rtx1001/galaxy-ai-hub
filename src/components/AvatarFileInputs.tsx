import { Dispatch, MutableRefObject, SetStateAction } from "react";
import { PersonalityPreset } from "../appCore";

type AvatarFileInputsProps = {
  avatarTargetPersonalityIdRef: MutableRefObject<string | null>;
  personalityAvatarPickerRef: MutableRefObject<HTMLInputElement | null>;
  readAvatarImage: (file: File | undefined, onReady: (dataUrl: string) => void) => void;
  selectedPersonalityId: string;
  setPersonalityAvatar: Dispatch<SetStateAction<string>>;
  setPersonalityPresets: Dispatch<SetStateAction<PersonalityPreset[]>>;
  setUserAvatar: Dispatch<SetStateAction<string>>;
  userAvatarPickerRef: MutableRefObject<HTMLInputElement | null>;
};

export function AvatarFileInputs({
  avatarTargetPersonalityIdRef,
  personalityAvatarPickerRef,
  readAvatarImage,
  selectedPersonalityId,
  setPersonalityAvatar,
  setPersonalityPresets,
  setUserAvatar,
  userAvatarPickerRef,
}: AvatarFileInputsProps) {
  return (
    <>
      <input
        ref={userAvatarPickerRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          readAvatarImage(event.target.files?.[0], setUserAvatar);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={personalityAvatarPickerRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          readAvatarImage(event.target.files?.[0], (dataUrl) => {
            const targetId = avatarTargetPersonalityIdRef.current || selectedPersonalityId;
            setPersonalityAvatar(dataUrl);
            setPersonalityPresets((prev) =>
              prev.map((preset) =>
                preset.id === targetId ? { ...preset, avatar: dataUrl } : preset,
              ),
            );
            avatarTargetPersonalityIdRef.current = null;
          });
          event.currentTarget.value = "";
        }}
      />
    </>
  );
}
