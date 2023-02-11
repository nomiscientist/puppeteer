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
import type PuppeteerUtil from '../injected/injected.js';
import {assert} from '../util/assert.js';
import {createFunction} from '../util/Function.js';
import {transposeIterableHandle} from './HandleIterator.js';
import type {Frame} from './Frame.js';
import type {WaitForSelectorOptions} from './IsolatedWorld.js';
import {MAIN_WORLD, PUPPETEER_WORLD} from './IsolatedWorlds.js';
import {LazyArg} from './LazyArg.js';
import type {Awaitable, AwaitableIterable} from './types.js';

/**
 * @internal
 */
export type QuerySelectorAll = (
  node: Node,
  selector: string,
  PuppeteerUtil: PuppeteerUtil
) => AwaitableIterable<Node>;

/**
 * @internal
 */
export type QuerySelector = (
  node: Node,
  selector: string,
  PuppeteerUtil: PuppeteerUtil
) => Awaitable<Node | null>;

/**
 * @internal
 */
export class QueryHandler {
  // Either one of these may be implemented, but at least one must be.
  static querySelectorAll?: QuerySelectorAll;
  static querySelector?: QuerySelector;

  static get _querySelector(): QuerySelector {
    if (this.querySelector) {
      return this.querySelector;
    }
    if (!this.querySelectorAll) {
      throw new Error('Cannot create default query selector');
    }

    const querySelector: QuerySelector = async (
      node,
      selector,
      PuppeteerUtil
    ) => {
      const querySelectorAll =
        'FUNCTION_DEFINITION' as unknown as QuerySelectorAll;
      const results = querySelectorAll(node, selector, PuppeteerUtil);
      for await (const result of results) {
        return result;
      }
      return null;
    };

    return (this.querySelector = createFunction(
      querySelector
        .toString()
        .replace("'FUNCTION_DEFINITION'", this.querySelectorAll.toString())
    ) as typeof querySelector);
  }

  static get _querySelectorAll(): QuerySelectorAll {
    if (this.querySelectorAll) {
      return this.querySelectorAll;
    }
    if (!this.querySelector) {
      throw new Error('Cannot create default query selector');
    }

    const querySelectorAll: QuerySelectorAll = async function* (
      node,
      selector,
      PuppeteerUtil
    ) {
      const querySelector = 'FUNCTION_DEFINITION' as unknown as QuerySelector;
      const result = await querySelector(node, selector, PuppeteerUtil);
      if (result) {
        yield result;
      }
    };

    return (this.querySelectorAll = createFunction(
      querySelectorAll
        .toString()
        .replace("'FUNCTION_DEFINITION'", this.querySelector.toString())
    ) as typeof querySelectorAll);
  }

  /**
   * Queries for multiple nodes given a selector and {@link ElementHandle}.
   *
   * Akin to {@link Window.prototype.querySelectorAll}.
   */
  static async *queryAll(
    element: ElementHandle<Node>,
    selector: string
  ): AwaitableIterable<ElementHandle<Node>> {
    const world = element.executionContext()._world;
    assert(world);
    const handle = await element.evaluateHandle(
      this._querySelectorAll,
      selector,
      LazyArg.create(context => {
        return context.puppeteerUtil;
      })
    );
    yield* transposeIterableHandle(handle);
  }

  /**
   * Queries for a single node given a selector and {@link ElementHandle}.
   *
   * Akin to {@link Window.prototype.querySelector}.
   */
  static async queryOne(
    element: ElementHandle<Node>,
    selector: string
  ): Promise<ElementHandle<Node> | null> {
    const world = element.executionContext()._world;
    assert(world);
    const result = await element.evaluateHandle(
      this._querySelector,
      selector,
      LazyArg.create(context => {
        return context.puppeteerUtil;
      })
    );
    if (!(result instanceof ElementHandle)) {
      await result.dispose();
      return null;
    }
    return result;
  }

  /**
   * Waits until a single node appears for a given selector and
   * {@link ElementHandle}.
   */
  static async waitFor(
    elementOrFrame: ElementHandle<Node> | Frame,
    selector: string,
    options: WaitForSelectorOptions,
    bindings = new Map<string, (...args: never[]) => unknown>()
  ): Promise<ElementHandle<Node> | null> {
    let frame: Frame;
    let element: ElementHandle<Node> | undefined;
    if (!(elementOrFrame instanceof ElementHandle)) {
      frame = elementOrFrame;
    } else {
      frame = elementOrFrame.frame;
      element = await frame.worlds[PUPPETEER_WORLD].adoptHandle(elementOrFrame);
    }
    const result = await frame.worlds[PUPPETEER_WORLD]._waitForSelectorInPage(
      this._querySelector,
      element,
      selector,
      options,
      bindings
    );
    if (element) {
      await element.dispose();
    }
    if (!(result instanceof ElementHandle)) {
      await result?.dispose();
      return null;
    }
    return frame.worlds[MAIN_WORLD].transferHandle(result);
  }
}
