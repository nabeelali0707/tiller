# Short demo video

`output/tiller-demo.mp4` is a 32-second, captioned, silent walkthrough of the working VS Code extension. It uses actual UI captures from the successful scripted addition repair `25837772-a1a8-49c3-bfd2-6b921cef3040`.

The six scenes introduce Tiller, show the execution timeline, highlight the failing baseline and passing final check, preview the repair, and link to the repository. The capture is cropped to the Tiller view and patch editor, excluding unrelated chat/sidebar content. Captions identify scripted decisions and distinguish the prototype from measured model-performance improvements. This is an edited walkthrough, not a continuous screen recording.

To rebuild, provide the original 1206×804 capture at `output/vscode-tiller-demo.png`, install FFmpeg and Sharp, and run `node scripts/create-demo-video.cjs`. If Sharp is supplied by a separate runtime, set `TILLER_SHARP_MODULE` to its absolute package directory. Outputs are local artifacts excluded from Git.
