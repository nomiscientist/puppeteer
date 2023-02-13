/**
 * Copyright 2023 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {ElementHandle} from '../api/ElementHandle.js';
import {ARIAQueryHandler} from './AriaQueryHandler.js';
import {customQueryHandlers} from './CustomQueryHandler.js';
import type {Frame} from './Frame.js';
import type {IsolatedWorld, WaitForSelectorOptions} from './IsolatedWorld.js';
import {PUPPETEER_WORLD} from './IsolatedWorlds.js';
import {QueryHandler, QuerySelector, QuerySelectorAll} from './QueryHandler.js';
import type {AwaitableIterable} from './types.js';

const noop = () => {};

/**
 * @internal
 */
export class PQueryHandler extends QueryHandler {
  static override querySelectorAll: QuerySelectorAll = (
    element,
    selector,
    {pQuerySelectorAll}
  ) => {
    return pQuerySelectorAll(element, selector);
  };
  static override querySelector: QuerySelector = (
    element,
    selector,
    {pQuerySelector}
  ) => {
    return pQuerySelector(element, selector);
  };

  static override async *queryAll(
    element: ElementHandle<Node>,
    selector: string
  ): AwaitableIterable<ElementHandle<Node>> {
    await this.#prepareQueryAll(element.frame.page());

    await element
      .executionContext()
      .createGlobalBinding(
        '__ariaQuerySelectorAll',
        ARIAQueryHandler.queryAll as (...args: unknown[]) => unknown
      );

    yield* super.queryAll(element, selector);
  }
  static override async queryOne(
    element: ElementHandle<Node>,
    selector: string
  ): Promise<ElementHandle<Node> | null> {
    let extraQuerySelectors = await element.evaluateHandle(_ => {});
    for (const [name, handler] of customQueryHandlers) {
      await world
        .evaluateOnNewDocument(
          (name, functionText) => {
            Object.assign(window, {
              [`__customQuerySelector_${name}`]: new Function(
                `return ${functionText}`
              )(),
            });
          },
          name,
          handler._querySelector.toString()
        )
        .catch(noop);
    }
    await this.#prepareQueryOne(element.frame.page());

    await element
      .executionContext()
      .createGlobalBinding(
        '__ariaQuerySelector',
        ARIAQueryHandler.queryOne as (...args: unknown[]) => unknown
      );

    return super.queryOne(element, selector);
  }
  static override async waitFor(
    elementOrFrame: ElementHandle<Node> | Frame,
    selector: string,
    options: WaitForSelectorOptions
  ): Promise<ElementHandle<Node> | null> {
    if (!(elementOrFrame instanceof ElementHandle)) {
      await this.#prepareQueryAll(
        (
          await elementOrFrame.worlds[PUPPETEER_WORLD].e()
        )._world!
      );
    } else {
      await this.#prepareQueryAll(elementOrFrame.executionContext()._world);
    }
    return super.waitFor(
      elementOrFrame,
      selector,
      options,
      new Map([['__ariaQuerySelectorAll', ARIAQueryHandler.queryAll]])
    );
  }
}
