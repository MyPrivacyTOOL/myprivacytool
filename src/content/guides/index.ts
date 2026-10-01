import type { ComponentType } from "react";
import RemovePersonalInfo, * as removePersonalInfo from "./removePersonalInfo";
import RemoveFromGoogle, * as removeFromGoogle from "./removeFromGoogle";
import StopSpam, * as stopSpam from "./stopSpam";

export interface GuideSection {
  id: string;
  title: string;
}

export interface GuideFaq {
  q: string;
  a: string;
}

export interface Guide {
  Content: ComponentType;
  sections: GuideSection[];
  faqs: GuideFaq[];
}

/** Long-form cornerstone guides, keyed by blog slug (metadata lives in blogPosts.json). */
export const guides: Record<string, Guide> = {
  "remove-personal-information-from-internet": {
    Content: RemovePersonalInfo,
    sections: removePersonalInfo.sections,
    faqs: removePersonalInfo.faqs,
  },
  "remove-your-name-and-info-from-google": {
    Content: RemoveFromGoogle,
    sections: removeFromGoogle.sections,
    faqs: removeFromGoogle.faqs,
  },
  "stop-spam-calls-texts-and-emails": {
    Content: StopSpam,
    sections: stopSpam.sections,
    faqs: stopSpam.faqs,
  },
};
