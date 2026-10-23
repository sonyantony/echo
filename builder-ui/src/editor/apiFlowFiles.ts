import { flowsApi } from '../api/flows';
import type { FlowFiles } from './flowFiles';

/** FlowFiles backed by the Builder API: Kaoto's side files are saved to the draft straight away. */
export class ApiFlowFiles implements FlowFiles {
  constructor(private readonly flowId: number) {}

  read(path: string) {
    return flowsApi.readFile(this.flowId, path);
  }

  write(path: string, content: string) {
    return flowsApi.writeFile(this.flowId, path, content);
  }

  async remove(path: string) {
    try {
      await flowsApi.deleteFile(this.flowId, path);
      return true;
    } catch {
      return false;
    }
  }

  async list() {
    return (await flowsApi.get(this.flowId)).files;
  }
}
