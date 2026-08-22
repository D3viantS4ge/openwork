import type { Scene } from "../scene.ts";
import { denOpenworkWeb, denPluginDetail, denSkillEditor } from "./den-web.ts";
import {
  libraryAddMcpModal,
  libraryAddMcpSlack,
  libraryAdvancedSettings,
  libraryCreateSkillModal,
  librarySkills,
  librarySlackConnection,
} from "./library.ts";
import { skillCreatedCard } from "./skill-created.ts";
import { openworkWebTab } from "./web-tab.ts";

export const scenes: Scene[] = [
  librarySkills,
  libraryCreateSkillModal,
  libraryAdvancedSettings,
  libraryAddMcpModal,
  libraryAddMcpSlack,
  librarySlackConnection,
  skillCreatedCard,
  denPluginDetail,
  denSkillEditor,
  denOpenworkWeb,
  openworkWebTab,
];
