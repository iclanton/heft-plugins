import path from 'path';
import type { IHeftPlugin, IHeftTaskSession, HeftConfiguration } from '@rushstack/heft';
import { TypingsGenerator } from '@rushstack/typings-generator';

const PLUGIN_NAME: string = 'image-typings-generator';

export interface IImageTypingsGeneratorHeftPluginOptions {
  fileExtensions: `.${string}`[];
  generatedTsFolder: string;
  srcFolder?: string;
}

export default class ImageTypingsGeneratorPlugin
  implements IHeftPlugin<IHeftTaskSession, IImageTypingsGeneratorHeftPluginOptions>
{
  public apply(
    heftSession: IHeftTaskSession,
    heftConfiguration: HeftConfiguration,
    { fileExtensions, generatedTsFolder, srcFolder = 'src' }: IImageTypingsGeneratorHeftPluginOptions
  ): void {
    const typingsGenerator: TypingsGenerator = new TypingsGenerator({
      fileExtensions,
      readFile: async (filePath: string) => '',
      srcFolder: path.resolve(heftConfiguration.buildFolderPath, srcFolder),
      generatedTsFolder: path.resolve(heftConfiguration.buildFolderPath, generatedTsFolder),
      parseAndGenerateTypings: () => 'declare const imageUrl: string;\nexport default imageUrl;',
      terminal: heftSession.logger.terminal
    });

    heftSession.hooks.run.tapPromise(PLUGIN_NAME, async () => {
      await typingsGenerator.generateTypingsAsync();
    });
  }
}
