import './index.css';

import Uploader from './uploader';
import { make, moveCaretToTheEnd, isEmpty } from './utils/dom';
import { getExtensionFromFileName } from './utils/file';
import { IconChevronDown, IconFile } from '@codexteam/icons';

const LOADER_TIMEOUT = 500;

/**
 * @typedef {object} AttachesToolData
 * @description Attaches Tool's output data format
 * @property {AttachesFileData} file - object containing information about the file
 * @property {string} title - file's title
 */

/**
 * @typedef {object} AttachesFileData
 * @description Attaches Tool's file format
 * @property {string} [url] - file's upload url
 * @property {string} [size] - file's size
 * @property {string} [extension] - file's extension
 * @property {string} [name] - file's name
 */

/**
 * @typedef {object} FileData
 * @description Attaches Tool's response from backend. Could contain any data.
 * @property {string} [url] - file's url
 * @property {string} [name] - file's name with extension
 * @property {string} [extension] - file's extension
 */

/**
 * @typedef {object} UploadResponseFormat
 * @description This format expected from backend on file upload
 * @property {number} success  - 1 for successful uploading, 0 for failure
 * @property {FileData} file - backend response with uploaded file data.
 */

/**
 * @typedef {object} AttachesToolConfig
 * @description Config supported by Tool
 * @property {string} endpoint - file upload url
 * @property {string} field - field name for uploaded file
 * @property {string} types - available mime-types
 * @property {string} errorMessage - message to show if file uploading failed
 * @property {object} [uploader] - optional custom uploader
 * @property {function(File): Promise.<UploadResponseFormat>} [uploader.uploadByFile] - custom method that upload file and returns response
 */

/**
 * @typedef {object} EditorAPI
 * @property {object} styles - Styles API {@link https://github.com/codex-team/editor.js/blob/next/types/api/styles.d.ts}
 * @property {object} i18n - Internationalization API {@link https://github.com/codex-team/editor.js/blob/next/types/api/i18n.d.ts}
 * @property {object} notifier - Notifier API {@link https://github.com/codex-team/editor.js/blob/next/types/api/notifier.d.ts}
 */

/**
 * @class AttachesTool
 * @classdesc AttachesTool for Editor.js 2.0
 */
export default class AttachesTool {
  /**
   * Make a safe filename for common filesystems (Windows/macOS/Linux).
   * - strips control chars
   * - replaces invalid filename chars with '_'
   * - trims trailing dots/spaces (Windows)
   * - avoids reserved device names (Windows)
   *
   * @param {string} name
   * @param {string} fallbackBase
   * @returns {string}
   */
  static sanitizeFileName(name, fallbackBase = 'attachment') {
    const raw = (typeof name === 'string' ? name : '').toString();

    const cleaned = raw
      .replace(/[\u0000-\u001F\u007F]/g, '') // control chars
      .replace(/[<>:"/\\|?*]/g, '_') // Windows-invalid filename chars
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, ''); // Windows: no trailing dot/space

    const base = cleaned || fallbackBase;

    // Windows reserved device names (case-insensitive)
    const upper = base.toUpperCase();
    const isReserved = (
      upper === 'CON' || upper === 'PRN' || upper === 'AUX' || upper === 'NUL' ||
      /^COM[1-9]$/.test(upper) || /^LPT[1-9]$/.test(upper)
    );

    const safe = isReserved ? `_${base}` : base;

    // Keep filename reasonably short to avoid filesystem limits; preserve end.
    const MAX_LEN = 180;
    return safe.length > MAX_LEN ? safe.slice(0, MAX_LEN).trim().replace(/[. ]+$/g, '') : safe;
  }

  /**
   * Build a download filename that matches the tool title.
   *
   * @param {AttachesToolData} data
   * @returns {string}
   */
  static buildDownloadFileName(data) {
    const file = data && data.file ? data.file : {};
    const rawTitle = (data && typeof data.title === 'string') ? data.title : '';

    const titleText = AttachesTool.repairLatin1Mojibake(
      AttachesTool.decodeURIComponentSafe(rawTitle.trim())
    );

    const fallbackTitle = AttachesTool.deriveTitleFromFile(file) || 'attachment';
    const fallbackExt = getExtensionFromFileName(fallbackTitle).toString().trim().replace(/^\./, '').toLowerCase();
    const fallbackBase = fallbackExt ? fallbackTitle.slice(0, -(fallbackExt.length + 1)) : fallbackTitle;

    const extHint = (
      (typeof file.extension === 'string' && file.extension.trim() !== '' ? file.extension : '') ||
      getExtensionFromFileName(file.name) ||
      (typeof file.url === 'string' && file.url.trim() !== ''
        ? getExtensionFromFileName((file.url.split('#')[0].split('?')[0].split('/').pop() || ''))
        : '')
    ).toString().trim().replace(/^\./, '').toLowerCase();

    const existingExt = getExtensionFromFileName(titleText).toString().trim().replace(/^\./, '').toLowerCase();
    const finalExt = existingExt || extHint;

    let basePart = titleText;
    if (existingExt) {
      basePart = titleText.slice(0, -(existingExt.length + 1));
    }

    const safeBase = AttachesTool.sanitizeFileName(
      basePart,
      AttachesTool.sanitizeFileName(fallbackBase, 'attachment')
    );
    const safeExt = (finalExt && /^[a-z0-9]{1,10}$/i.test(finalExt)) ? finalExt : '';

    return safeExt ? `${safeBase}.${safeExt}` : safeBase;
  }

  /**
   * Safe decode for percent-encoded strings (e.g. from URLs).
   *
   * @param {string} s
   * @returns {string}
   */
  static decodeURIComponentSafe(s) {
    if (typeof s !== 'string') return '';
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  /**
   * Try to repair common mojibake ("æµ‹è¯•.txt" -> "测试.txt") in browser.
   * Only applies when the string has latin1-supplement chars and no CJK.
   *
   * @param {string} s
   * @returns {string}
   */
  static repairLatin1Mojibake(s) {
    if (typeof s !== 'string') return '';
    const trimmed = s.trim();
    if (!trimmed) return '';

    const hasCJK = /[\u4e00-\u9fff]/.test(trimmed);
    if (hasCJK) return trimmed;

    const hasLatin1 = /[\u00C0-\u00FF]/.test(trimmed);
    if (!hasLatin1) return trimmed;

    if (typeof TextDecoder === 'undefined') return trimmed;

    try {
      const bytes = Uint8Array.from(Array.from(trimmed, (ch) => ch.charCodeAt(0) & 0xff));
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

      if (/[\u4e00-\u9fff]/.test(decoded) && !decoded.includes('\uFFFD')) {
        return decoded;
      }
    } catch (e) {
      // ignore
    }

    return trimmed;
  }

  /**
   * Derive a reasonable default title for the attachment.
   * Prefer backend-provided name, otherwise fallback to url's last segment.
   *
   * @param {object} file - uploaded file data
   * @returns {string}
   */
  static deriveTitleFromFile(file) {
    if (!file || typeof file !== 'object') {
      return '';
    }

    const normalize = (val) => {
      if (typeof val !== 'string') return '';
      const trimmed = val.trim();
      if (!trimmed) return '';
      // try decode percent-encoding first, then repair mojibake if needed
      return AttachesTool.repairLatin1Mojibake(AttachesTool.decodeURIComponentSafe(trimmed));
    };

    if (typeof file.title === 'string' && file.title.trim() !== '') {
      return normalize(file.title);
    }

    if (typeof file.name === 'string' && file.name.trim() !== '') {
      return normalize(file.name);
    }

    if (typeof file.url === 'string' && file.url.trim() !== '') {
      try {
        const url = file.url.trim();
        const cleanUrl = url.split('#')[0].split('?')[0];
        const last = cleanUrl.split('/').pop();

        return normalize(last || '');
      } catch (e) {
        return '';
      }
    }

    return '';
  }
  /**
   * @param {object} options - tool constructor options
   * @param {AttachesToolData} [options.data] - previously saved data
   * @param {AttachesToolConfig} options.config - user defined config
   * @param {EditorAPI} options.api - Editor.js API
   * @param {boolean} options.readOnly - flag indicates whether the Read-Only mode enabled or not
   */
  constructor({ data, config, api, readOnly }) {
    this.api = api;
    this.readOnly = readOnly;

    this.nodes = {
      wrapper: null,
      button: null,
      title: null,
      download: null,
      parseButton: null,
    };

    this._data = {
      file: {},
      title: '',
    };

    this.config = {
      endpoint: config.endpoint || '',
      field: config.field || 'file',
      types: config.types || '*',
      buttonText: config.buttonText || 'Select file to upload',
      errorMessage: config.errorMessage || 'File upload failed',
      uploader: config.uploader || undefined,
      additionalRequestHeaders: config.additionalRequestHeaders || {},
      // QNotes 扩展：PDF 解析（Docling）
      parseEndpoint: config.parseEndpoint || '',
      parseButtonText: config.parseButtonText || '解析',
      parseLoadingText: config.parseLoadingText || '解析中…',
      parseErrorMessage: config.parseErrorMessage || '解析失败',
      parseRequestHeaders: config.parseRequestHeaders || config.additionalRequestHeaders || {},
    };

    if (data !== undefined && !isEmpty(data)) {
      this.data = data;
    }

    /**
     * Module for files uploading
     */
    this.uploader = new Uploader({
      config: this.config,
      onUpload: (response) => this.onUpload(response),
      onError: (error) => this.uploadingFailed(error),
    });

    this.enableFileUpload = this.enableFileUpload.bind(this);
    this.onParsePdfClick = this.onParsePdfClick.bind(this);
  }

  /**
   * Get Tool toolbox settings
   * icon - Tool icon's SVG
   * title - title to show in toolbox
   *
   * @returns {{icon: string, title: string}}
   */
  static get toolbox() {
    return {
      icon: IconFile,
      title: 'Attachment',
    };
  }

  /**
   * Returns true to notify core that read-only is supported
   *
   * @returns {boolean}
   */
  static get isReadOnlySupported() {
    return true;
  }

  /**
   * Tool's CSS classes
   *
   * @returns {object}
   */
  get CSS() {
    return {
      baseClass: this.api.styles.block,
      apiButton: this.api.styles.button,
      loader: this.api.styles.loader,
      /**
       * Tool's classes
       */
      wrapper: 'cdx-attaches',
      wrapperWithFile: 'cdx-attaches--with-file',
      wrapperLoading: 'cdx-attaches--loading',
      button: 'cdx-attaches__button',
      title: 'cdx-attaches__title',
      size: 'cdx-attaches__size',
      downloadButton: 'cdx-attaches__download-button',
      parseButton: 'cdx-attaches__parse-button',
      fileInfo: 'cdx-attaches__file-info',
      fileIcon: 'cdx-attaches__file-icon',
      fileIconBackground: 'cdx-attaches__file-icon-background',
      fileIconLabel: 'cdx-attaches__file-icon-label',
    };
  }

  /**
   * Returns true if the current attachment is a PDF.
   * @returns {boolean}
   */
  isPdfAttachment() {
    try {
      const f = this.data && this.data.file ? this.data.file : {};
      const ext = (f.extension || getExtensionFromFileName(f.name) || '').toString().trim().replace('.', '').toLowerCase();
      return ext === 'pdf';
    } catch (e) {
      return false;
    }
  }

  /**
   * Possible files' extension colors
   *
   * @returns {object}
   */
  get EXTENSIONS() {
    return {
      doc: '#1483E9',
      docx: '#1483E9',
      odt: '#1483E9',
      pdf: '#DB2F2F',
      rtf: '#744FDC',
      tex: '#5a5a5b',
      txt: '#5a5a5b',
      pptx: '#E35200',
      ppt: '#E35200',
      mp3: '#eab456',
      mp4: '#f676a6',
      xls: '#11AE3D',
      html: '#2988f0',
      htm: '#2988f0',
      png: '#AA2284',
      jpg: '#D13359',
      jpeg: '#D13359',
      gif: '#f6af76',
      zip: '#4f566f',
      rar: '#4f566f',
      exe: '#e26f6f',
      svg: '#bf5252',
      key: '#00B2FF',
      sketch: '#FFC700',
      ai: '#FB601D',
      psd: '#388ae5',
      dmg: '#e26f6f',
      json: '#2988f0',
      csv: '#11AE3D',
    };
  }

  /**
   * Validate block data:
   * - check for emptiness
   *
   * @param {AttachesToolData} savedData — data received after saving
   * @returns {boolean} false if saved data is not correct, otherwise true
   * @public
   */
  validate(savedData) {
    if (isEmpty(savedData.file)) {
      return false;
    }

    return true;
  }

  /**
   * Return Block data
   *
   * @param {HTMLElement} toolsContent - block main element returned by the render method
   * @returns {AttachesToolData}
   */
  save(toolsContent) {
    /**
     * If file was uploaded
     */
    if (this.pluginHasData()) {
      const titleElement = toolsContent.querySelector(`.${this.CSS.title}`);

      if (titleElement) {
        Object.assign(this.data, {
          title: titleElement.innerHTML,
        });
      }
    }

    return this.data;
  }

  /**
   * Renders Block content
   *
   * @returns {HTMLDivElement}
   */
  render() {
    const holder = make('div', this.CSS.baseClass);

    this.nodes.wrapper = make('div', this.CSS.wrapper);

    if (this.pluginHasData()) {
      this.showFileData();
    } else {
      this.prepareUploadButton();
    }

    holder.appendChild(this.nodes.wrapper);

    return holder;
  }

  /**
   * Prepares button for file uploading
   */
  prepareUploadButton() {
    this.nodes.button = make('div', [this.CSS.apiButton, this.CSS.button]);
    this.nodes.button.innerHTML = `${IconFile} ${this.config.buttonText}`;

    if (!this.readOnly) {
      this.nodes.button.addEventListener('click', this.enableFileUpload);
    }

    this.nodes.wrapper.appendChild(this.nodes.button);
  }

  /**
   * Fires after clicks on the Toolbox AttachesTool Icon
   * Initiates click on the Select File button
   *
   * @public
   */
  appendCallback() {
    this.nodes.button.click();
  }

  /**
   * Checks if any of Tool's fields have data
   *
   * @returns {boolean}
   */
  pluginHasData() {
    return this.data.title !== '' || Object.values(this.data.file).some(item => item !== undefined);
  }

  /**
   * Allow to upload files on button click
   */
  enableFileUpload() {
    this.uploader.uploadSelectedFile({
      onPreview: () => {
        this.nodes.wrapper.classList.add(this.CSS.wrapperLoading, this.CSS.loader);
      },
    });
  }

  /**
   * File uploading callback
   *
   * @param {UploadResponseFormat} response - server returned data
   */
  onUpload(response) {
    const body = response;

    try {
      if (body.success && body.file !== undefined && !isEmpty(body.file)) {
        const derivedTitle = AttachesTool.deriveTitleFromFile(body.file);

        this.data = {
          file: body.file,
          title: derivedTitle,
        };

        this.nodes.button.remove();
        this.showFileData();

        moveCaretToTheEnd(this.nodes.title);

        this.removeLoader();
      } else {
        this.uploadingFailed(this.config.errorMessage);
      }
    } catch (error) {
      console.error('Attaches tool error:', error);
      this.uploadingFailed(this.config.errorMessage);
    }

    /**
     * Trigger onChange function when upload finished
     */
    this.api.blocks.getBlockByIndex(this.api.blocks.getCurrentBlockIndex()).dispatchChange();
  }

  /**
   * Handles uploaded file's extension and appends corresponding icon
   *
   * @param {object<string, string | number | boolean>} file - uploaded file data got from the backend. Could contain any fields.
   */
  appendFileIcon(file) {
    const extensionProvided = file.extension;
    const extension = extensionProvided || getExtensionFromFileName(file.name);
    const extensionColor = this.EXTENSIONS[extension];
    const extensionMaxLen = 4;

    const wrapper = make('div', this.CSS.fileIcon);
    const background = make('div', this.CSS.fileIconBackground);

    if (extensionColor) {
      background.style.backgroundColor = extensionColor;
    }

    wrapper.appendChild(background);

    /**
     * If extension exists, add it via a separate element
     * Otherwise, append file icon
     */
    if (extension) {
      /**
       * Trim long extensions
       *  'sketch' -> 'sket…'
       */
      let extensionVisible = extension;

      if (extension.length > extensionMaxLen) {
        extensionVisible = extension.substring(0, extensionMaxLen) + '…';
      }

      const extensionLabel = make('div', this.CSS.fileIconLabel, {
        textContent: extensionVisible, // trimmed
        title: extension, // full text for hover
      });

      if (extensionColor) {
        extensionLabel.style.backgroundColor = extensionColor;
      }

      wrapper.appendChild(extensionLabel);
    } else {
      background.innerHTML = IconFile;
    }

    this.nodes.wrapper.appendChild(wrapper);
  }

  /**
   * Removes tool's loader
   */
  removeLoader() {
    setTimeout(() => this.nodes.wrapper.classList.remove(this.CSS.wrapperLoading, this.CSS.loader), LOADER_TIMEOUT);
  }

  /**
   * If upload is successful, show info about the file
   */
  showFileData() {
    this.nodes.wrapper.classList.add(this.CSS.wrapperWithFile);

    const { file, title } = this.data;

    this.appendFileIcon(file);

    const fileInfo = make('div', this.CSS.fileInfo);

    this.nodes.title = make('div', this.CSS.title, {
      contentEditable: this.readOnly === false,
    });

    this.nodes.title.dataset.placeholder = this.api.i18n.t('File title');
    this.nodes.title.textContent = title || '';
    fileInfo.appendChild(this.nodes.title);

    if (file.size) {
      let sizePrefix;
      let formattedSize;
      const fileSize = make('div', this.CSS.size);

      if (Math.log10(+file.size) >= 6) {
        sizePrefix = 'MiB';
        formattedSize = file.size / Math.pow(2, 20);
      } else {
        sizePrefix = 'KiB';
        formattedSize = file.size / Math.pow(2, 10);
      }

      fileSize.textContent = formattedSize.toFixed(1);
      fileSize.setAttribute('data-size', sizePrefix);
      fileInfo.appendChild(fileSize);
    }

    this.nodes.wrapper.appendChild(fileInfo);

    // QNotes 扩展：如果是 PDF，显示“解析”按钮（由服务端调用 Docling，返回 blocks 后插入当前笔记）
    try {
      const canParse = !this.readOnly && this.isPdfAttachment() && typeof this.config.parseEndpoint === 'string' && this.config.parseEndpoint.trim() !== '';
      if (canParse) {
        this.nodes.parseButton = make('button', this.CSS.parseButton, {
          type: 'button',
          textContent: this.config.parseButtonText || '解析',
        });
        this.nodes.parseButton.addEventListener('click', this.onParsePdfClick);
        this.nodes.wrapper.appendChild(this.nodes.parseButton);
      }
    } catch (e) {
      // ignore UI errors
    }

    if (file.url !== undefined) {
      const downloadIcon = make('a', this.CSS.downloadButton, {
        innerHTML: IconChevronDown,
        href: file.url,
        download: AttachesTool.buildDownloadFileName(this.data),
        target: '_blank',
      });

      this.nodes.download = downloadIcon;

      /**
       * Keep download name in sync with edited title.
       */
      if (!this.readOnly) {
        this.nodes.title.addEventListener('input', () => {
          try {
            const liveTitle = this.nodes.title ? this.nodes.title.textContent : '';
            if (this.nodes.download) {
              this.nodes.download.download = AttachesTool.buildDownloadFileName({ ...this.data, title: liveTitle });
            }
          } catch (e) {
            // ignore
          }
        });
      }

      this.nodes.wrapper.appendChild(downloadIcon);
    }
  }

  /**
   * Parse current PDF attachment into Editor.js blocks via QNotes backend.
   */
  async onParsePdfClick() {
    if (this._isParsingPdf) return;
    this._isParsingPdf = true;

    const btn = this.nodes.parseButton;
    const prevText = btn ? btn.textContent : '';
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = this.config.parseLoadingText || '解析中…';
      }

      const parseEndpoint = (this.config.parseEndpoint || '').toString().trim();
      if (!parseEndpoint) throw new Error(this.config.parseErrorMessage || '解析失败');

      // 当前笔记 ID：由 QNotes 前端全局状态提供
      const noteId = (window.QNotesApp && window.QNotesApp.state) ? window.QNotesApp.state.currentNoteId : null;
      if (!noteId) throw new Error('未找到当前笔记（note_id）');

      const blockIndex = this.api.blocks.getCurrentBlockIndex();
      if (typeof blockIndex !== 'number' || blockIndex < 0) throw new Error('无法定位当前块');

      const headers = {
        ...(this.config.parseRequestHeaders || {}),
        'Content-Type': 'application/json',
      };

      const resp = await fetch(parseEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          note_id: noteId,
          block_index: blockIndex,
          mode: 'sync',
          // 默认等待 120s；可由后端根据 max_wait_seconds 约束
          max_wait_seconds: 120,
        }),
      });

      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        const msg = (json && (json.error || json.message)) ? (json.error || json.message) : (this.config.parseErrorMessage || '解析失败');
        throw new Error(msg);
      }

      // async fallback（202）：仅返回 task_id
      if (resp.status === 202 && json && json.task_id && !json.blocks) {
        this.api.notifier.show({
          message: `解析任务已提交：${json.task_id}`,
          style: 'success',
        });
        return;
      }

      const blocks = json && Array.isArray(json.blocks) ? json.blocks : [];
      if (!blocks.length) {
        const msg = (json && json.error) ? String(json.error) : '解析结果为空';
        throw new Error(msg);
      }

      // 插入到当前附件块之后
      let insertIndex = blockIndex + 1;
      for (const b of blocks) {
        if (!b || typeof b !== 'object') continue;
        if (!b.type || typeof b.type !== 'string') continue;
        const data = (b.data && typeof b.data === 'object') ? b.data : {};
        try {
          this.api.blocks.insert(b.type, data, undefined, insertIndex, false);
          insertIndex += 1;
        } catch (e) {
          // 单个 block 插入失败：跳过并继续
          console.warn('Insert block failed:', e);
        }
      }

      // 标记变更
      try {
        this.api.blocks.getBlockByIndex(blockIndex).dispatchChange();
      } catch (e) {
        // ignore
      }

      this.api.notifier.show({
        message: 'PDF 解析完成，已插入到笔记中',
        style: 'success',
      });
    } catch (e) {
      const msg = e && e.message ? e.message : (this.config.parseErrorMessage || '解析失败');
      this.api.notifier.show({
        message: msg,
        style: 'error',
      });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevText || (this.config.parseButtonText || '解析');
      }
      this._isParsingPdf = false;
    }
  }

  /**
   * If file uploading failed, remove loader and show notification
   *
   * @param {string} errorMessage -  error message
   */
  uploadingFailed(errorMessage) {
    this.api.notifier.show({
      message: errorMessage,
      style: 'error',
    });

    this.removeLoader();
  }

  /**
   * Return Attaches Tool's data
   *
   * @returns {AttachesToolData}
   */
  get data() {
    return this._data;
  }

  /**
   * Stores all Tool's data
   *
   * @param {AttachesToolData} data - data to set
   */
  set data({ file, title }) {
    const safeTitle = (typeof title === 'string' && title.trim() !== '')
      ? title
      : AttachesTool.deriveTitleFromFile(file);

    this._data = {
      file,
      title: safeTitle,
    };
  }
}
