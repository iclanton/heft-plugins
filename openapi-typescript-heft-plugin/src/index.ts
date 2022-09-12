import * as path from "path";
import {
  default as openapiTypescript,
  OpenAPI2,
  OpenAPI3,
  SchemaObject,
} from "openapi-typescript";
import type {
  HeftConfiguration,
  HeftSession,
  IHeftPlugin,
  ScopedLogger,
} from "@rushstack/heft";
import {
  JsonFile,
  JsonSchema,
  Async,
  FileSystem,
  Import,
} from "@rushstack/node-core-library";
import type { FSWatcher } from "chokidar";

const chokidar: typeof import("chokidar") = Import.lazy("chokidar", require);
const jsYaml: typeof import("js-yaml") = Import.lazy("js-yaml", require);

const PLUGIN_NAME: string = "openapi-typescript-plugin";

export interface IOpenApiTypescriptPluginEntry {
  sourcePath: string;
  outputPath: string;
}

export interface IOpenApiTypescriptPluginOptions {
  entries: IOpenApiTypescriptPluginEntry[];
}

interface IResolvedOpenApiTypescriptPluginEntry
  extends IOpenApiTypescriptPluginEntry {
  resolvedSourcePath: string;
  resolvedOutputPath: string;
}

export class OpenApiTypescriptPlugin
  implements IHeftPlugin<IOpenApiTypescriptPluginOptions>
{
  public readonly pluginName: string = PLUGIN_NAME;

  public apply(
    heftSession: HeftSession,
    heftConfiguration: HeftConfiguration,
    options: IOpenApiTypescriptPluginOptions
  ): void {
    heftSession.hooks.build.tap(PLUGIN_NAME, (build) => {
      build.hooks.preCompile.tap(PLUGIN_NAME, (preCompile) => {
        preCompile.hooks.run.tapPromise(PLUGIN_NAME, async () => {
          const jsonSchema: JsonSchema = JsonSchema.fromFile(
            `${__dirname}/schemas/openapi-typescript-plugin.schema.json`
          );
          jsonSchema.validateObject(options, "config/heft.json");

          await this._runOpenApiTypescriptAsync(
            options,
            heftSession,
            heftConfiguration,
            build.properties.watchMode
          );
        });
      });
    });
  }

  private async _runOpenApiTypescriptAsync(
    options: IOpenApiTypescriptPluginOptions,
    heftSession: HeftSession,
    heftConfiguration: HeftConfiguration,
    isWatchMode: boolean
  ): Promise<void> {
    const resolvedEntries: IResolvedOpenApiTypescriptPluginEntry[] = [];
    for (const entry of options.entries) {
      resolvedEntries.push({
        ...entry,
        resolvedSourcePath: path.resolve(
          heftConfiguration.buildFolder,
          entry.sourcePath
        ),
        resolvedOutputPath: path.resolve(
          heftConfiguration.buildFolder,
          entry.outputPath
        ),
      });
    }

    const logger: ScopedLogger =
      heftSession.requestScopedLogger("openapi-typescript");

    await Async.forEachAsync(
      resolvedEntries,
      async (entry) => {
        await this._generateOpenApiTypescript(entry, logger);
      },
      { concurrency: 5 }
    );

    if (isWatchMode) {
      for (const entry of resolvedEntries) {
        const watcher: FSWatcher = chokidar.watch(entry.resolvedSourcePath, {
          ignoreInitial: true,
        });
        const boundGenerateOpenApiTypescriptFunction: () => Promise<void> =
          this._generateOpenApiTypescript.bind(this, entry, logger);
        watcher.on("add", boundGenerateOpenApiTypescriptFunction);
        watcher.on("change", boundGenerateOpenApiTypescriptFunction);
        watcher.on("unlink", boundGenerateOpenApiTypescriptFunction);
        watcher.on("error", (error: Error) => logger.emitError(error));
      }
    }
  }

  private async _generateOpenApiTypescript(
    entry: IResolvedOpenApiTypescriptPluginEntry,
    logger: ScopedLogger
  ): Promise<void> {
    let fileContents: string;
    try {
      fileContents = await FileSystem.readFileAsync(entry.resolvedSourcePath);
    } catch (error) {
      if (FileSystem.isNotExistError(error as Error)) {
        logger.emitError(
          new Error(`OpenAPI file not found: ${entry.sourcePath}`)
        );
        await FileSystem.deleteFileAsync(entry.resolvedOutputPath);
        return;
      } else {
        throw error;
      }
    }

    let parsedApiFile: OpenAPI2 | OpenAPI3 | Record<string, SchemaObject>;
    try {
      if (entry.resolvedSourcePath.endsWith(".yaml")) {
        parsedApiFile = jsYaml.safeLoad(fileContents);
      } else if (entry.resolvedSourcePath.endsWith(".json")) {
        parsedApiFile = JsonFile.parseString(fileContents);
      } else {
        logger.emitError(
          new Error(`Unsupported OpenAPI file format: ${entry.sourcePath}`)
        );
        return;
      }
    } catch (error) {
      logger.emitError(
        new Error(`Failed to parse OpenAPI file ${entry.sourcePath}: ${error}`)
      );
      return;
    }

    let output: string;
    try {
      output = await openapiTypescript(parsedApiFile);
    } catch (error) {
      logger.emitError(
        new Error(
          `Error generating typescript from OpenAPI file ${entry.sourcePath}: ${error}`
        )
      );
      return;
    }

    try {
      await FileSystem.writeFileAsync(entry.resolvedOutputPath, output, {
        ensureFolderExists: true,
      });
    } catch (error) {
      logger.emitError(
        new Error(
          `Error writing typescript file to ${entry.outputPath}: ${error}`
        )
      );
    }
  }
}

export default new OpenApiTypescriptPlugin();
