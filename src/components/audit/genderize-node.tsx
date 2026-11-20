import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { genderizeText, type ActorGender } from "@/lib/audit/gender";

/**
 * Проходит по готовой фразе журнала (JSX) и согласует двойные окончания
 * в текстовых узлах с полом автора. Элементы и их свойства не меняются.
 */
export function genderizeNode(node: ReactNode, gender: ActorGender): ReactNode {
  if (gender !== "male" && gender !== "female") return node;
  if (typeof node === "string") return genderizeText(node, gender);
  if (Array.isArray(node))
    return Children.map(node, (child) => genderizeNode(child, gender));
  if (isValidElement<{ children?: ReactNode }>(node) && node.props.children !== undefined)
    return cloneElement(node, undefined, genderizeNode(node.props.children, gender));
  return node;
}
