import * as path from 'path';
import { default as openapiTypescript, OpenAPI2, OpenAPI3, SchemaObject } from 'openapi-typescript';
import type { HeftConfiguration, IHeftTaskSession, IHeftTaskPlugin, IScopedLogger } from '@rushstack/heft';
import { JsonFile, Async, FileSystem } from '@rushstack/node-core-library';

const PLUGIN_NAME: string = 'openapi-typescript-plugin';

export interface IOpenApiTypescriptPluginEntry {
  sourcePath: string;
  outputPath: string;
}

export interface IOpenApiTypescriptPluginOptions {
  entries: IOpenApiTypescriptPluginEntry[];
}

interface IResolvedOpenApiTypescriptPluginEntry extends IOpenApiTypescriptPluginEntry {
  resolvedSourcePath: string;
  resolvedOutputPath: string;
}

export default class OpenApiTypescriptPlugin implements IHeftTaskPlugin<IOpenApiTypescriptPluginOptions> {
  public apply(
    heftSession: IHeftTaskSession,
    heftConfiguration: HeftConfiguration,
    options: IOpenApiTypescriptPluginOptions
  ): void {
    heftSession.hooks.run.tapPromise(PLUGIN_NAME, async () => {
      await this._runOpenApiTypescriptAsync(options, heftSession, heftConfiguration);
    });
  }

  private async _runOpenApiTypescriptAsync(
    options: IOpenApiTypescriptPluginOptions,
    { logger }: IHeftTaskSession,
    { buildFolderPath }: HeftConfiguration
  ): Promise<void> {
    const resolvedEntries: IResolvedOpenApiTypescriptPluginEntry[] = [];
    for (const entry of options.entries) {
      resolvedEntries.push({
        ...entry,
        resolvedSourcePath: path.resolve(buildFolderPath, entry.sourcePath),
        resolvedOutputPath: path.resolve(buildFolderPath, entry.outputPath)
      });
    }

    await Async.forEachAsync(
      resolvedEntries,
      async (entry) => {
        await this._generateOpenApiTypescript(entry, logger);
      },
      { concurrency: 5 }
    );
  }

  private async _generateOpenApiTypescript(
    entry: IResolvedOpenApiTypescriptPluginEntry,
    logger: IScopedLogger
  ): Promise<void> {
    let fileContents: string;
    try {
      fileContents = await FileSystem.readFileAsync(entry.resolvedSourcePath);
    } catch (error) {
      if (FileSystem.isNotExistError(error as Error)) {
        logger.emitError(new Error(`OpenAPI file not found: ${entry.sourcePath}`));
        await FileSystem.deleteFileAsync(entry.resolvedOutputPath);
        return;
      } else {
        throw error;
      }
    }

    let parsedApiFile: OpenAPI2 | OpenAPI3 | Record<string, SchemaObject>;
    try {
      if (entry.resolvedSourcePath.endsWith('.yaml')) {
        const { default: jsYaml } = await import('js-yaml');
        parsedApiFile = jsYaml.safeLoad(fileContents);
      } else if (entry.resolvedSourcePath.endsWith('.json')) {
        parsedApiFile = JsonFile.parseString(fileContents);
      } else {
        logger.emitError(new Error(`Unsupported OpenAPI file format: ${entry.sourcePath}`));
        return;
      }
    } catch (error) {
      logger.emitError(new Error(`Failed to parse OpenAPI file ${entry.sourcePath}: ${error}`));
      return;
    }

    let output: string;
    try {
      output = await openapiTypescript(parsedApiFile);
    } catch (error) {
      logger.emitError(
        new Error(`Error generating typescript from OpenAPI file ${entry.sourcePath}: ${error}`)
      );
      return;
    }

    try {
      await FileSystem.writeFileAsync(entry.resolvedOutputPath, output, {
        ensureFolderExists: true
      });
    } catch (error) {
      logger.emitError(new Error(`Error writing typescript file to ${entry.outputPath}: ${error}`));
    }
  }
}
