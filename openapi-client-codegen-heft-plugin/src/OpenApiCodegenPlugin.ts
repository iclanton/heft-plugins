import * as path from 'path';
import type { HeftConfiguration, IScopedLogger, IHeftTaskPlugin, IHeftTaskSession } from '@rushstack/heft';
import { FileSystem, Import, Executable } from '@rushstack/node-core-library';
import { ChildProcess } from 'child_process';

const PLUGIN_NAME: string = 'openapi-client-codegen-plugin';

export interface IOpenApiCodegenPluginOptions {
  openapiVersion: string;
  sourceFile: string;
  outputFolderPath: string;
  additionalOptions: Record<string, string>;
}

const DEFAULT_OPTIONS: Record<string, string> = {
  supportsES6: 'true',
  typescriptThreePlus: 'true',
  withoutRuntimeChecks: 'true',
  nullSafeAdditionalProps: 'true'
};

export default class OpenApiCodegenPlugin implements IHeftTaskPlugin<IOpenApiCodegenPluginOptions> {
  public apply(
    heftSession: IHeftTaskSession,
    { buildFolderPath }: HeftConfiguration,
    options: IOpenApiCodegenPluginOptions
  ): void {
    heftSession.hooks.run.tapPromise(PLUGIN_NAME, async () => {
      const resolvedOutputFolderPath: string = path.resolve(buildFolderPath, options.outputFolderPath);

      const logger: IScopedLogger = heftSession.logger;
      let resolvedSourcePath: string;
      try {
        resolvedSourcePath = Import.resolveModule({
          modulePath: options.sourceFile,
          baseFolderPath: buildFolderPath
        });
      } catch (error) {
        logger.emitError(new Error(`Unable to resolve source file "${options.sourceFile}": ${error}`));
        return;
      }

      const resolvedToolPath: string = Import.resolveModule({
        modulePath: '@openapitools/openapi-generator-cli/main.js',
        baseFolderPath: __dirname
      });

      async function runOpenApiCommandAsync(args: string[], logsOutputBaseFilename: string): Promise<void> {
        interface IRunResult {
          stdout: string[];
          stderr: string[];
          code: number;
          wroteToStderr: boolean;
        }

        const result: IRunResult = await new Promise((resolve: (result: IRunResult) => void) => {
          const childProcess: ChildProcess = Executable.spawn(process.argv0, [resolvedToolPath, ...args]);
          let wroteToStderr: boolean = false;
          const stderr: string[] = [];
          childProcess.stderr?.on('data', (data: Buffer) => {
            stderr.push(data.toString());
            wroteToStderr = true;
          });

          const stdout: string[] = [];
          childProcess.stdout?.on('data', (data: Buffer) => {
            stdout.push(data.toString());
          });

          childProcess.on('close', (code: number) => {
            resolve({ code, stdout, stderr, wroteToStderr });
          });
        });

        await FileSystem.ensureFolderAsync(resolvedOutputFolderPath);
        const stdoutFilename: string = `${resolvedOutputFolderPath}/openapi-generator-cli-${logsOutputBaseFilename}.stdout.log`;
        const stderrFilename: string = `${resolvedOutputFolderPath}/openapi-generator-cli-${logsOutputBaseFilename}.stderr.log`;
        await Promise.all([
          FileSystem.writeFileAsync(stdoutFilename, result.stdout.join('')),
          FileSystem.writeFileAsync(stderrFilename, result.stderr.join(''))
        ]);

        if (result.code !== 0) {
          logger.emitError(
            new Error(
              `openapi-generator-cli exited with status code "${result.code}". ` +
                `Logs have been written to "${stdoutFilename}" and ${stderrFilename}.`
            )
          );
        } else if (result.wroteToStderr) {
          logger.emitError(
            new Error(
              `openapi-generator-cli wrote to stderr. Logs have been written to ` +
                `"${stdoutFilename}" and ${stderrFilename}.`
            )
          );
        }
      }

      await runOpenApiCommandAsync(['version-manager', 'set', options.openapiVersion], 'set-version');

      const additionalOptions: string = this._generateOptionsParameter({
        ...DEFAULT_OPTIONS,
        ...options.additionalOptions
      });

      await runOpenApiCommandAsync(
        [
          'generate',
          '-i',
          resolvedSourcePath,
          '-g',
          'typescript-fetch',
          '-o',
          resolvedOutputFolderPath,
          additionalOptions
        ],
        'generate'
      );
    });
  }

  private _generateOptionsParameter(options: Record<string, string>): string {
    const parameterValue: string = Object.keys(options)
      .map((key: string) => {
        return `${key}=${options[key]}`;
      })
      .join(',');
    return `--additional-properties=${parameterValue}`;
  }
}
