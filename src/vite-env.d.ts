/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SPLITLINK_ADDRESS: string | undefined;
  readonly VITE_SPLITLINK_DEPLOY_BLOCK: string | undefined;
  readonly VITE_SPLITLINK_EXPECTED_BYTECODE_HASH: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
