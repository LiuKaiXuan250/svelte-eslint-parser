import type {
  SvelteAttribute,
  SvelteAwaitBlock,
  SvelteAwaitCatchBlock,
  SvelteAwaitPendingBlock,
  SvelteAwaitThenBlock,
  SvelteComponentElement,
  SvelteConstTag,
  SvelteDebugTag,
  SvelteEachBlock,
  SvelteElement,
  SvelteElseBlockAlone,
  SvelteHTMLComment,
  SvelteHTMLElement,
  SvelteIfBlock,
  SvelteIfBlockAlone,
  SvelteKeyBlock,
  SvelteMemberExpressionName,
  SvelteMustacheTag,
  SvelteName,
  SvelteProgram,
  SvelteScriptElement,
  SvelteSpecialDirective,
  SvelteSpecialElement,
  SvelteStyleElement,
  SvelteText,
} from "../../ast";
import type ESTree from "estree";
import type { Context } from "../../context";
import type * as SvAST from "../svelte-ast-types";

import {
  convertAwaitBlock,
  convertEachBlock,
  convertIfBlock,
  convertKeyBlock,
} from "./block";
import { getWithLoc, indexOf } from "./common";
import {
  convertMustacheTag,
  convertDebugTag,
  convertRawMustacheTag,
} from "./mustache";
import { convertText } from "./text";
import { convertAttributes } from "./attr";
import { convertConstTag } from "./const";
import { sortNodes } from "../sort";
import type { ScriptLetBlockParam } from "../../context/script-let";
import { ParseError } from "../..";

/* eslint-disable complexity -- X */
/** Convert for Fragment or Element or ... */
export function* convertChildren(
  /* eslint-enable complexity -- X */
  fragment: { children: SvAST.TemplateNode[] },
  parent:
    | SvelteProgram
    | SvelteElement
    | SvelteIfBlock
    | SvelteElseBlockAlone
    | SvelteEachBlock
    | SvelteAwaitPendingBlock
    | SvelteAwaitThenBlock
    | SvelteAwaitCatchBlock
    | SvelteKeyBlock,
  ctx: Context
): IterableIterator<
  | SvelteText
  | SvelteElement
  | SvelteMustacheTag
  | SvelteDebugTag
  | SvelteConstTag
  | SvelteIfBlockAlone
  | SvelteEachBlock
  | SvelteAwaitBlock
  | SvelteKeyBlock
  | SvelteHTMLComment
> {
  for (const child of fragment.children) {
    if (child.type === "Comment") {
      yield convertComment(child, parent, ctx);
      continue;
    }
    if (child.type === "Text") {
      if (!child.data && child.start === child.end) {
        continue;
      }
      yield convertText(child, parent, ctx);
      continue;
    }
    if (child.type === "Element") {
      if (child.name.includes(":")) {
        yield convertSpecialElement(child, parent, ctx);
      } else {
        yield convertHTMLElement(child, parent, ctx);
      }
      continue;
    }
    if (child.type === "InlineComponent") {
      if (child.name.includes(":")) {
        yield convertSpecialElement(child, parent, ctx);
      } else {
        yield convertComponentElement(child, parent, ctx);
      }
      continue;
    }
    if (child.type === "Slot") {
      yield convertSlotElement(child, parent, ctx);
      continue;
    }
    if (child.type === "MustacheTag") {
      yield convertMustacheTag(child, parent, ctx);
      continue;
    }
    if (child.type === "RawMustacheTag") {
      yield convertRawMustacheTag(child, parent, ctx);
      continue;
    }
    if (child.type === "IfBlock") {
      // {#if expr} {/if}
      yield convertIfBlock(child, parent, ctx);
      continue;
    }
    if (child.type === "EachBlock") {
      // {#each expr as item, index (key)} {/each}
      yield convertEachBlock(child, parent, ctx);
      continue;
    }
    if (child.type === "AwaitBlock") {
      // {#await promise} {:then number} {:catch error} {/await}
      yield convertAwaitBlock(child, parent, ctx);
      continue;
    }
    if (child.type === "KeyBlock") {
      // {#key expression}...{/key}
      yield convertKeyBlock(child, parent, ctx);
      continue;
    }
    if (child.type === "Window") {
      yield convertWindowElement(child, parent, ctx);
      continue;
    }
    if (child.type === "Body") {
      yield convertBodyElement(child, parent, ctx);
      continue;
    }
    if (child.type === "Head") {
      yield convertHeadElement(child, parent, ctx);
      continue;
    }
    if (child.type === "Title") {
      yield convertTitleElement(child, parent, ctx);
      continue;
    }
    if (child.type === "Options") {
      yield convertOptionsElement(child, parent, ctx);
      continue;
    }
    if (child.type === "SlotTemplate") {
      yield convertSlotTemplateElement(child, parent, ctx);
      continue;
    }
    if (child.type === "DebugTag") {
      yield convertDebugTag(child, parent, ctx);
      continue;
    }
    if (child.type === "ConstTag") {
      yield convertConstTag(child, parent, ctx);
      continue;
    }
    if (child.type === "Document") {
      yield convertDocumentElement(child, parent, ctx);
      continue;
    }

    throw new Error(`Unknown type:${(child as any).type}`);
  }
}

/** Extract `let:` directives. */
function extractLetDirectives(fragment: {
  attributes: SvAST.AttributeOrDirective[];
}): {
  letDirectives: SvAST.LetDirective[];
  attributes: Exclude<SvAST.AttributeOrDirective, SvAST.LetDirective>[];
} {
  const letDirectives: SvAST.LetDirective[] = [];
  const attributes: Exclude<SvAST.AttributeOrDirective, SvAST.LetDirective>[] =
    [];
  for (const attr of fragment.attributes) {
    if (attr.type === "Let") {
      letDirectives.push(attr);
    } else {
      attributes.push(attr);
    }
  }
  return { letDirectives, attributes };
}

/** Check if children needs a scope. */
function needScopeByChildren(fragment: {
  children: SvAST.TemplateNode[];
}): boolean {
  for (const child of fragment.children) {
    if (child.type === "ConstTag") {
      return true;
    }
  }
  return false;
}

/** Convert for HTML Comment */
function convertComment(
  node: SvAST.Comment,
  parent: SvelteHTMLComment["parent"],
  ctx: Context
): SvelteHTMLComment {
  const comment: SvelteHTMLComment = {
    type: "SvelteHTMLComment",
    value: node.data,
    parent,
    ...ctx.getConvertLocation(node),
  };

  ctx.addToken("HTMLComment", node);

  return comment;
}

/** Convert for HTMLElement */
function convertHTMLElement(
  node: SvAST.Element | SvAST.Slot | SvAST.Title,
  parent: SvelteHTMLElement["parent"],
  ctx: Context
): SvelteHTMLElement {
  const locs = ctx.getConvertLocation(node);
  const element: SvelteHTMLElement = {
    type: "SvelteElement",
    kind: "html",
    name: null as any,
    startTag: {
      type: "SvelteStartTag",
      attributes: [],
      selfClosing: false,
      parent: null as any,
      range: [locs.range[0], null as any],
      loc: {
        start: {
          line: locs.loc.start.line,
          column: locs.loc.start.column,
        },
        end: null as any,
      },
    },
    children: [],
    endTag: null,
    parent,
    ...locs,
  };
  element.startTag.parent = element;
  const elementName = node.name;

  const { letDirectives, attributes } = extractLetDirectives(node);
  const letParams: ScriptLetBlockParam[] = [];
  if (letDirectives.length) {
    ctx.letDirCollections.beginExtract();
    element.startTag.attributes.push(
      ...convertAttributes(letDirectives, element.startTag, elementName, ctx)
    );
    letParams.push(...ctx.letDirCollections.extract().getLetParams());
  }
  if (!letParams.length && !needScopeByChildren(node)) {
    element.startTag.attributes.push(
      ...convertAttributes(attributes, element.startTag, elementName, ctx)
    );
    element.children.push(...convertChildren(node, element, ctx));
  } else {
    ctx.scriptLet.nestBlock(element, letParams);
    element.startTag.attributes.push(
      ...convertAttributes(attributes, element.startTag, elementName, ctx)
    );
    sortNodes(element.startTag.attributes);
    element.children.push(...convertChildren(node, element, ctx));
    ctx.scriptLet.closeScope();
  }

  extractElementTags(element, ctx, {
    buildNameNode: (openTokenRange) => {
      ctx.addToken("HTMLIdentifier", openTokenRange);
      const name: SvelteName = {
        type: "SvelteName",
        name: elementName,
        parent: element,
        ...ctx.getConvertLocation(openTokenRange),
      };
      return name;
    },
  });

  if (
    element.name.name === "script" ||
    element.name.name === "style" ||
    (element.name.name === "template" && ctx.findBlock(element))
  ) {
    // Restore the block-like element.
    for (const child of element.children) {
      if (child.type === "SvelteText") {
        child.value = ctx.code.slice(...child.range);
      }
    }
    if (element.name.name === "script") {
      ctx.stripScriptCode(
        element.startTag.range[1],
        element.endTag?.range[0] ?? element.range[1]
      );
    }
  }
  if (element.startTag.selfClosing && element.name.name.endsWith("-")) {
    // Restore the self-closing block.
    const selfClosingBlock =
      /^[a-z]-+$/iu.test(element.name.name) &&
      ctx.findSelfClosingBlock(element);
    if (selfClosingBlock) {
      element.name.name = selfClosingBlock.originalTag;
    }
  }

  return element;
}

/** Convert for Special element. e.g. <svelte:self> */
function convertSpecialElement(
  node:
    | SvAST.InlineComponent
    | SvAST.Element
    | SvAST.Window
    | SvAST.Document
    | SvAST.Body
    | SvAST.Head
    | SvAST.Options
    | SvAST.SlotTemplate,
  parent: SvelteSpecialElement["parent"],
  ctx: Context
): SvelteSpecialElement {
  const locs = ctx.getConvertLocation(node);
  const element: SvelteSpecialElement = {
    type: "SvelteElement",
    kind: "special",
    name: null as any,
    startTag: {
      type: "SvelteStartTag",
      attributes: [],
      selfClosing: false,
      parent: null as any,
      range: [locs.range[0], null as any],
      loc: {
        start: {
          line: locs.loc.start.line,
          column: locs.loc.start.column,
        },
        end: null as any,
      },
    },
    children: [],
    endTag: null,
    parent,
    ...locs,
  };
  element.startTag.parent = element;
  const elementName = node.name;

  const { letDirectives, attributes } = extractLetDirectives(node);
  const letParams: ScriptLetBlockParam[] = [];
  if (letDirectives.length) {
    ctx.letDirCollections.beginExtract();
    element.startTag.attributes.push(
      ...convertAttributes(letDirectives, element.startTag, elementName, ctx)
    );
    letParams.push(...ctx.letDirCollections.extract().getLetParams());
  }
  if (!letParams.length && !needScopeByChildren(node)) {
    element.startTag.attributes.push(
      ...convertAttributes(attributes, element.startTag, elementName, ctx)
    );
    element.children.push(...convertChildren(node, element, ctx));
  } else {
    ctx.scriptLet.nestBlock(element, letParams);
    element.startTag.attributes.push(
      ...convertAttributes(attributes, element.startTag, elementName, ctx)
    );
    sortNodes(element.startTag.attributes);
    element.children.push(...convertChildren(node, element, ctx));
    ctx.scriptLet.closeScope();
  }

  const thisExpression =
    (node.type === "InlineComponent" &&
      elementName === "svelte:component" &&
      node.expression) ||
    (node.type === "Element" && elementName === "svelte:element" && node.tag);
  if (thisExpression) {
    processThisAttribute(node, thisExpression, element, ctx);
  }

  extractElementTags(element, ctx, {
    buildNameNode: (openTokenRange) => {
      ctx.addToken("HTMLIdentifier", openTokenRange);
      const name: SvelteName = {
        type: "SvelteName",
        name: elementName,
        parent: element,
        ...ctx.getConvertLocation(openTokenRange),
      };
      return name;
    },
  });

  return element;
}

/** process `this=` */
function processThisAttribute(
  node: SvAST.SvelteElement | SvAST.InlineSvelteComponent,
  thisValue: string | ESTree.Expression,
  element: SvelteSpecialElement,
  ctx: Context
) {
  let thisNode: SvelteSpecialDirective | SvelteAttribute;
  if (typeof thisValue === "string") {
    // this="..."
    const startIndex = findStartIndexOfThis(node, ctx);
    const eqIndex = ctx.code.indexOf("=", startIndex + 4 /* t,h,i,s */);
    const valueStartIndex = indexOf(
      ctx.code,
      (c) => Boolean(c.trim()),
      eqIndex + 1
    );
    const quote = ctx.code.startsWith(thisValue, valueStartIndex)
      ? null
      : ctx.code[valueStartIndex];
    const literalStartIndex = quote
      ? valueStartIndex + quote.length
      : valueStartIndex;
    const literalEndIndex = literalStartIndex + thisValue.length;
    const endIndex = quote ? literalEndIndex + quote.length : literalEndIndex;
    const thisAttr: SvelteAttribute = {
      type: "SvelteAttribute",
      key: null as any,
      boolean: false,
      value: [],
      parent: element.startTag,
      ...ctx.getConvertLocation({ start: startIndex, end: endIndex }),
    };
    thisAttr.key = {
      type: "SvelteName",
      name: "this",
      parent: thisAttr,
      ...ctx.getConvertLocation({ start: startIndex, end: eqIndex }),
    };
    thisAttr.value.push({
      type: "SvelteLiteral",
      value: thisValue,
      parent: thisAttr,
      ...ctx.getConvertLocation({
        start: literalStartIndex,
        end: literalEndIndex,
      }),
    });
    // this
    ctx.addToken("HTMLIdentifier", {
      start: startIndex,
      end: startIndex + 4,
    });
    // =
    ctx.addToken("Punctuator", {
      start: eqIndex,
      end: eqIndex + 1,
    });
    if (quote) {
      // "
      ctx.addToken("Punctuator", {
        start: valueStartIndex,
        end: literalStartIndex,
      });
    }
    ctx.addToken("HTMLText", {
      start: literalStartIndex,
      end: literalEndIndex,
    });
    if (quote) {
      // "
      ctx.addToken("Punctuator", {
        start: literalEndIndex,
        end: endIndex,
      });
    }
    thisNode = thisAttr;
  } else {
    // this={...}
    const eqIndex = ctx.code.lastIndexOf("=", getWithLoc(thisValue).start);
    const startIndex = ctx.code.lastIndexOf("this", eqIndex);
    const closeIndex = ctx.code.indexOf("}", getWithLoc(thisValue).end);
    const endIndex = indexOf(
      ctx.code,
      (c) => c === ">" || !c.trim(),
      closeIndex
    );
    const thisDir: SvelteSpecialDirective = {
      type: "SvelteSpecialDirective",
      kind: "this",
      key: null as any,
      expression: null as any,
      parent: element.startTag,
      ...ctx.getConvertLocation({ start: startIndex, end: endIndex }),
    };
    thisDir.key = {
      type: "SvelteSpecialDirectiveKey",
      parent: thisDir,
      ...ctx.getConvertLocation({ start: startIndex, end: eqIndex }),
    };
    // this
    ctx.addToken("HTMLIdentifier", {
      start: startIndex,
      end: startIndex + 4,
    });
    // =
    ctx.addToken("Punctuator", {
      start: eqIndex,
      end: eqIndex + 1,
    });
    ctx.scriptLet.addExpression(thisValue, thisDir, null, (es) => {
      thisDir.expression = es;
    });
    thisNode = thisDir;
  }

  const targetIndex = element.startTag.attributes.findIndex(
    (attr) => thisNode.range[1] <= attr.range[0]
  );
  if (targetIndex === -1) {
    element.startTag.attributes.push(thisNode);
  } else {
    element.startTag.attributes.splice(targetIndex, 0, thisNode);
  }
}

/** Find the start index of `this` */
function findStartIndexOfThis(
  node: SvAST.SvelteElement | SvAST.InlineSvelteComponent,
  ctx: Context
) {
  // Get the end index of `svelte:element`
  const startIndex = ctx.code.indexOf(node.name, node.start) + node.name.length;
  const sortedAttrs = [...node.attributes].sort((a, b) => a.start - b.start);
  // Find the start index of `this` from the end index of `svelte:element`.
  // However, it only seeks to the start index of the first attribute (or the end index of element node).
  let thisIndex = indexOf(
    ctx.code,
    (_c, index) => ctx.code.startsWith("this", index),
    startIndex,
    sortedAttrs[0]?.start ?? node.end
  );
  while (thisIndex < 0) {
    if (sortedAttrs.length === 0)
      throw new ParseError("Cannot resolved `this` attribute.", thisIndex, ctx);
    // Step3: Find the start index of `this` from the end index of attribute.
    // However, it only seeks to the start index of the first attribute (or the end index of element node).
    const nextStartIndex = sortedAttrs.shift()!.end;
    thisIndex = indexOf(
      ctx.code,
      (_c, index) => ctx.code.startsWith("this", index),
      nextStartIndex,
      sortedAttrs[0]?.start ?? node.end
    );
  }
  return thisIndex;
}

/** Convert for ComponentElement */
function convertComponentElement(
  node: SvAST.InlineComponent,
  parent: SvelteComponentElement["parent"],
  ctx: Context
): SvelteComponentElement {
  const locs = ctx.getConvertLocation(node);
  const element: SvelteComponentElement = {
    type: "SvelteElement",
    kind: "component",
    name: null as any,
    startTag: {
      type: "SvelteStartTag",
      attributes: [],
      selfClosing: false,
      parent: null as any,
      range: [locs.range[0], null as any],
      loc: {
        start: {
          line: locs.loc.start.line,
          column: locs.loc.start.column,
        },
        end: null as any,
      },
    },
    children: [],
    endTag: null,
    parent,
    ...locs,
  };
  element.startTag.parent = element;
  const elementName = node.name;

  const { letDirectives, attributes } = extractLetDirectives(node);
  const letParams: ScriptLetBlockParam[] = [];
  if (letDirectives.length) {
    ctx.letDirCollections.beginExtract();
    element.startTag.attributes.push(
      ...convertAttributes(letDirectives, element.startTag, elementName, ctx)
    );
    letParams.push(...ctx.letDirCollections.extract().getLetParams());
  }
  if (!letParams.length && !needScopeByChildren(node)) {
    element.startTag.attributes.push(
      ...convertAttributes(attributes, element.startTag, elementName, ctx)
    );
    element.children.push(...convertChildren(node, element, ctx));
  } else {
    ctx.scriptLet.nestBlock(element, letParams);
    element.startTag.attributes.push(
      ...convertAttributes(attributes, element.startTag, elementName, ctx)
    );
    sortNodes(element.startTag.attributes);
    element.children.push(...convertChildren(node, element, ctx));
    ctx.scriptLet.closeScope();
  }

  extractElementTags(element, ctx, {
    buildNameNode: (openTokenRange) => {
      const chains = elementName.split(".");
      const id = chains.shift()!;
      const idRange = {
        start: openTokenRange.start,
        end: openTokenRange.start + id.length,
      };
      // ctx.addToken("Identifier", idRange)

      const identifier: ESTree.Identifier = {
        type: "Identifier",
        name: id,
        // @ts-expect-error -- ignore
        parent: element,
        ...ctx.getConvertLocation(idRange),
      };
      let object: SvelteComponentElement["name"] = identifier;

      // eslint-disable-next-line func-style -- var
      let esCallback = (es: ESTree.Identifier) => {
        element.name = es;
      };

      let start = idRange.end + 1;
      for (const name of chains) {
        const range = { start, end: start + name.length };
        ctx.addToken("HTMLIdentifier", range);
        const mem: SvelteMemberExpressionName = {
          type: "SvelteMemberExpressionName",
          object,
          property: {
            type: "SvelteName",
            name,
            parent: null as any,
            ...ctx.getConvertLocation(range),
          },
          parent: element,
          ...ctx.getConvertLocation({
            start: openTokenRange.start,
            end: range.end,
          }),
        };
        mem.property.parent = mem;
        (object as any).parent = mem;
        object = mem;
        start = range.end + 1;
        if (mem.object === identifier) {
          esCallback = (es: ESTree.Identifier) => {
            mem.object = es;
          };
        }
      }

      ctx.scriptLet.addExpression(
        identifier,
        (identifier as any).parent,
        null,
        esCallback
      );

      return object;
    },
  });
  return element;
}

/** Convert for Slot */
function convertSlotElement(
  node: SvAST.Slot,
  parent: SvelteHTMLElement["parent"],
  ctx: Context
): SvelteHTMLElement {
  // Slot translates to SvelteHTMLElement.
  const element = convertHTMLElement(node, parent, ctx);
  ctx.slots.add(element);
  return element;
}

/** Convert for window element. e.g. <svelte:window> */
function convertWindowElement(
  node: SvAST.Window,
  parent: SvelteSpecialElement["parent"],
  ctx: Context
): SvelteSpecialElement {
  return convertSpecialElement(node, parent, ctx);
}

/** Convert for document element. e.g. <svelte:document> */
function convertDocumentElement(
  node: SvAST.Document,
  parent: SvelteSpecialElement["parent"],
  ctx: Context
): SvelteSpecialElement {
  return convertSpecialElement(node, parent, ctx);
}

/** Convert for body element. e.g. <svelte:body> */
function convertBodyElement(
  node: SvAST.Body,
  parent: SvelteSpecialElement["parent"],
  ctx: Context
): SvelteSpecialElement {
  return convertSpecialElement(node, parent, ctx);
}

/** Convert for head element. e.g. <svelte:head> */
function convertHeadElement(
  node: SvAST.Head,
  parent: SvelteSpecialElement["parent"],
  ctx: Context
): SvelteSpecialElement {
  return convertSpecialElement(node, parent, ctx);
}

/** Convert for title element. e.g. <title> */
function convertTitleElement(
  node: SvAST.Title,
  parent: SvelteHTMLElement["parent"],
  ctx: Context
): SvelteHTMLElement {
  return convertHTMLElement(node, parent, ctx);
}

/** Convert for options element. e.g. <svelte:options> */
function convertOptionsElement(
  node: SvAST.Options,
  parent: SvelteSpecialElement["parent"],
  ctx: Context
): SvelteSpecialElement {
  return convertSpecialElement(node, parent, ctx);
}

/** Convert for <svelte:fragment> element. */
function convertSlotTemplateElement(
  node: SvAST.SlotTemplate,
  parent: SvelteSpecialElement["parent"],
  ctx: Context
): SvelteSpecialElement {
  return convertSpecialElement(node, parent, ctx);
}

/** Extract element tag and tokens */
export function extractElementTags<
  E extends SvelteScriptElement | SvelteElement | SvelteStyleElement
>(
  element: E,
  ctx: Context,
  options: {
    buildNameNode: (openTokenRange: {
      start: number;
      end: number;
    }) => E["name"];
    extractAttribute?: boolean;
  }
): void {
  const startTagNameEnd = indexOf(
    ctx.code,
    (c) => c === "/" || c === ">" || !c.trim(),
    element.range[0] + 1
  );
  const openTokenRange = {
    start: element.range[0] + 1,
    end: startTagNameEnd,
  };

  element.name = options.buildNameNode(openTokenRange);

  const startTagEnd =
    ctx.code.indexOf(
      ">",
      element.startTag.attributes[element.startTag.attributes.length - 1]
        ?.range[1] ?? openTokenRange.end
    ) + 1;
  element.startTag.range[1] = startTagEnd;
  element.startTag.loc.end = ctx.getLocFromIndex(startTagEnd);

  if (ctx.code[element.range[1] - 1] !== ">") {
    // Have not end tag
    return;
  }
  if (ctx.code[element.range[1] - 2] === "/") {
    // self close
    element.startTag.selfClosing = true;
    return;
  }

  const endTagOpen = ctx.code.lastIndexOf("<", element.range[1] - 1);
  if (endTagOpen <= startTagEnd - 1) {
    // void element
    return;
  }
  const endTagNameStart = endTagOpen + 2;
  const endTagNameEnd = indexOf(
    ctx.code,
    (c) => c === ">" || !c.trim(),
    endTagNameStart
  );
  const endTagClose = ctx.code.indexOf(">", endTagNameEnd);
  element.endTag = {
    type: "SvelteEndTag",
    parent: element,
    ...ctx.getConvertLocation({ start: endTagOpen, end: endTagClose + 1 }),
  };
  ctx.addToken("HTMLIdentifier", {
    start: endTagNameStart,
    end: endTagNameEnd,
  });
}
