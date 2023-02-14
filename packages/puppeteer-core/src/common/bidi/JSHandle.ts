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

import {ElementHandle} from '../../api/ElementHandle.js';
import {EvaluateFuncWith, HandleFor, HandleOr} from '../../common/types.js';
import {releaseReference} from './utils.js';
import {Page} from './Page.js';
import {JSHandle as BaseJSHandle} from '../../api/JSHandle.js';
import {BidiSerializer} from './Serializer.js';
import {Connection} from './Connection.js';
import * as Bidi from 'chromium-bidi/lib/cjs/protocol/protocol.js';

export class JSHandle<T = unknown> extends BaseJSHandle<T> {
  #disposed = false;
  #context;
  #remoteObject;

  constructor(context: Page, remoteObject: Bidi.CommonDataTypes.RemoteValue) {
    super();
    this.#context = context;
    this.#remoteObject = remoteObject;
  }

  context(): Page {
    return this.#context;
  }

  get connecton(): Connection {
    return this.#context.connection;
  }

  override get disposed(): boolean {
    return this.#disposed;
  }

  override async evaluate<
    Params extends unknown[],
    Func extends EvaluateFuncWith<T, Params> = EvaluateFuncWith<T, Params>
  >(
    pageFunction: Func | string,
    ...args: Params
  ): Promise<Awaited<ReturnType<Func>>> {
    return await this.context().evaluate(pageFunction, this, ...args);
  }

  override async evaluateHandle<
    Params extends unknown[],
    Func extends EvaluateFuncWith<T, Params> = EvaluateFuncWith<T, Params>
  >(
    pageFunction: Func | string,
    ...args: Params
  ): Promise<HandleFor<Awaited<ReturnType<Func>>>> {
    return await this.context().evaluateHandle(pageFunction, this, ...args);
  }

  override async getProperty<K extends keyof T>(
    propertyName: HandleOr<K>
  ): Promise<HandleFor<T[K]>>;
  override async getProperty(propertyName: string): Promise<HandleFor<unknown>>;
  override async getProperty<K extends keyof T>(
    propertyName: HandleOr<K>
  ): Promise<HandleFor<T[K]>> {
    return await this.evaluateHandle((object, propertyName) => {
      return object[propertyName as K];
    }, propertyName);
  }

  override async getProperties(): Promise<Map<string, BaseJSHandle>> {
    // TODO(lightning00blade): Temporary solution
    const keys = await this.evaluate(object => {
      return Object.getOwnPropertyNames(object);
    });
    const map: Map<string, BaseJSHandle> = new Map();
    const results = await Promise.all(
      keys.map(key => {
        return this.getProperty(key);
      })
    );

    keys.forEach((key, index) => {
      const handle = results[index];
      if (handle) {
        map.set(key, handle);
      }
    });

    return map;
  }

  override async jsonValue(): Promise<T> {
    if (!('handle' in this.#remoteObject)) {
      return BidiSerializer.deserialize(this.#remoteObject);
    }
    const value = await this.evaluate(object => {
      return object;
    });
    if (value === undefined) {
      throw new Error('Could not serialize referenced object');
    }
    return value;
  }

  override asElement(): ElementHandle<Node> | null {
    return null;
  }

  override async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    if ('handle' in this.#remoteObject) {
      await releaseReference(this.connecton, this.#remoteObject);
    }
  }

  override toString(): string {
    if (!('handle' in this.#remoteObject)) {
      return 'JSHandle:' + BidiSerializer.deserialize(this.#remoteObject);
    }

    return 'JSHandle@' + this.#remoteObject.type;
  }

  override get id(): string | undefined {
    return 'handle' in this.#remoteObject
      ? this.#remoteObject.handle
      : undefined;
  }

  bidiObject(): Bidi.CommonDataTypes.RemoteValue {
    return this.#remoteObject;
  }
}
