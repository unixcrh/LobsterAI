import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { i18nService } from '@/services/i18n';

import {
  type OfficePreviewZoomControlsConfig,
  useRegisterOfficePreviewZoomControls,
} from '../OfficePreviewActionsContext';
import { useOfficePreviewZoom } from '../OfficeZoomControls';
import { getExtension } from './excelPreprocess';

const t = (key: string) => i18nService.t(key);

interface CellData {
  v: string;
  bgColor?: string;
  fontColor?: string;
  bold?: boolean;
  colSpan?: number;
  rowSpan?: number;
  hidden?: boolean;
}

interface MergeRange {
  sr: number;
  sc: number;
  er: number;
  ec: number;
}

interface SheetData {
  name: string;
  rows: CellData[][];
  colWidths: number[];
}

interface SheetFallbackRendererProps {
  data: ArrayBuffer;
  fileName: string;
  error?: string | null;
}

const ROW_HEIGHT = 28;
const COL_HEADER_HEIGHT = 28;
const ROW_HEADER_WIDTH = 46;
const MIN_COL_WIDTH = 48;
const MAX_COL_WIDTH = 520;

interface XlsxColumnInfo {
  wpx?: number;
  wch?: number;
  width?: number;
}

export const SheetFallbackRenderer: React.FC<SheetFallbackRendererProps> = ({ data, fileName }) => {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const { zoomFactor, zoomIn, zoomOut, resetZoom, handleWheelZoom } = useOfficePreviewZoom();
  const zoomControls = useMemo<OfficePreviewZoomControlsConfig | null>(() => {
    if (sheets.length === 0) return null;
    return {
      zoomFactor,
      onZoomOut: zoomOut,
      onZoomIn: zoomIn,
      onResetZoom: resetZoom,
    };
  }, [resetZoom, sheets.length, zoomFactor, zoomIn, zoomOut]);

  useRegisterOfficePreviewZoomControls(zoomControls);

  const handleColumnResize = useCallback((columnIndex: number, width: number) => {
    setSheets(prevSheets => prevSheets.map((sheet, sheetIndex) => {
      if (sheetIndex !== activeSheet) return sheet;
      const colWidths = sheet.colWidths.map((currentWidth, index) => (
        index === columnIndex ? clampColumnWidth(width) : currentWidth
      ));
      return { ...sheet, colWidths };
    }));
  }, [activeSheet]);

  useEffect(() => {
    let cancelled = false;

    const parse = async () => {
      try {
        const XLSX = await import('xlsx');
        const ext = getExtension(fileName);
        const workbook = ext === '.csv' || ext === '.tsv'
          ? XLSX.read(new TextDecoder('utf-8').decode(new Uint8Array(data)), {
              type: 'string',
              FS: ext === '.tsv' ? '\t' : undefined,
            })
          : XLSX.read(new Uint8Array(data), { type: 'array', cellStyles: true });

        const parsed: SheetData[] = workbook.SheetNames.map(name => {
          const sheet = workbook.Sheets[name];
          const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
          const colCount = range.e.c - range.s.c + 1;
          const colWidths = getColumnWidths(sheet as Record<string, unknown>, range, colCount);
          const rows: CellData[][] = [];

          for (let r = range.s.r; r <= range.e.r; r++) {
            const row: CellData[] = [];
            for (let c = range.s.c; c <= range.e.c; c++) {
              const addr = XLSX.utils.encode_cell({ r, c });
              const cell = sheet[addr];
              const cellData: CellData = { v: cell ? cell.w ?? String(cell.v ?? '') : '' };
              const style = cell?.s;
              if (style) {
                if (style.fgColor?.rgb) cellData.bgColor = `#${style.fgColor.rgb}`;
                if (style.color?.rgb) cellData.fontColor = `#${style.color.rgb}`;
                if (style.bold) cellData.bold = true;
              }
              row.push(cellData);
            }
            rows.push(row);
          }

          const merges: MergeRange[] = (sheet['!merges'] || []).map((m: { s: { r: number; c: number }; e: { r: number; c: number } }) => ({
            sr: m.s.r - range.s.r,
            sc: m.s.c - range.s.c,
            er: m.e.r - range.s.r,
            ec: m.e.c - range.s.c,
          }));
          applyMerges(rows, merges);

          return { name, rows, colWidths };
        });

        if (!cancelled) {
          setSheets(parsed);
          setActiveSheet(0);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };

    parse();
    return () => { cancelled = true; };
  }, [data, fileName]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-red-500">
        {t('artifactDocumentError')}: {error}
      </div>
    );
  }

  if (sheets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        {t('artifactDocumentLoading')}
      </div>
    );
  }

  const currentSheet = sheets[activeSheet] || sheets[0];
  const rowHeight = scaleSheetSize(ROW_HEIGHT, zoomFactor);
  const colHeaderHeight = scaleSheetSize(COL_HEADER_HEIGHT, zoomFactor);
  const rowHeaderWidth = scaleSheetSize(ROW_HEADER_WIDTH, zoomFactor);
  const totalWidth = rowHeaderWidth + currentSheet.colWidths.reduce((sum, width) => sum + width * zoomFactor, 0);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white text-[#383a42]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#e0e0e0] px-2 py-1">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {sheets.map((sheet, i) => (
            <button
              key={sheet.name}
              onClick={() => setActiveSheet(i)}
              className={`whitespace-nowrap rounded px-2 py-0.5 text-xs transition-colors ${
                i === activeSheet ? 'bg-[#217346]/10 font-medium text-[#217346]' : 'text-[#666] hover:bg-[#f0f2f5] hover:text-[#383a42]'
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      </div>

      <div ref={parentRef} className="flex-1 overflow-auto" onWheel={handleWheelZoom}>
        <div style={{ width: totalWidth, minWidth: '100%' }}>
          <ColumnHeaders
            colWidths={currentSheet.colWidths}
            colHeaderHeight={colHeaderHeight}
            rowHeaderWidth={rowHeaderWidth}
            zoomFactor={zoomFactor}
            onColumnResize={handleColumnResize}
          />
          <VirtualRows
            key={rowHeight}
            rows={currentSheet.rows}
            parentRef={parentRef}
            colWidths={currentSheet.colWidths}
            rowHeight={rowHeight}
            rowHeaderWidth={rowHeaderWidth}
            zoomFactor={zoomFactor}
          />
        </div>
      </div>

      <div className="shrink-0 border-t border-[#e0e0e0] px-3 py-1 text-xs text-[#777]">
        {currentSheet.rows.length.toLocaleString()} {t('artifactRowCount')}
      </div>
    </div>
  );
};

function ColumnHeaders({
  colWidths,
  colHeaderHeight,
  rowHeaderWidth,
  zoomFactor,
  onColumnResize,
}: {
  colWidths: number[];
  colHeaderHeight: number;
  rowHeaderWidth: number;
  zoomFactor: number;
  onColumnResize: (columnIndex: number, width: number) => void;
}) {
  return (
    <div className="sticky top-0 z-10 flex border-b border-[#d8d8d8] bg-[#f3f4f6]" style={{ height: colHeaderHeight }}>
      <div className="shrink-0 border-r border-[#d8d8d8]" style={{ width: rowHeaderWidth }} />
      {colWidths.map((colWidth, i) => (
        <div
          key={i}
          className="relative flex shrink-0 items-center justify-center border-r border-[#d8d8d8] text-[11px] font-medium text-[#666]"
          style={{ width: colWidth * zoomFactor, fontSize: 11 * zoomFactor, lineHeight: `${colHeaderHeight}px` }}
        >
          {columnName(i)}
          <div
            role="separator"
            aria-label={`${t('artifactResizeColumn')} ${columnName(i)}`}
            aria-orientation="vertical"
            aria-valuemin={MIN_COL_WIDTH}
            aria-valuemax={MAX_COL_WIDTH}
            aria-valuenow={Math.round(colWidth)}
            tabIndex={0}
            title={t('artifactResizeColumn')}
            className="absolute right-[-4px] top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-[#217346]/20 focus:bg-[#217346]/25 focus:outline-none"
            onPointerDown={event => startColumnResize(event, i, colWidth, zoomFactor, onColumnResize)}
            onKeyDown={event => handleColumnResizeKeyDown(event, i, colWidth, onColumnResize)}
          />
        </div>
      ))}
    </div>
  );
}

const VirtualRows: React.FC<{
  rows: CellData[][];
  parentRef: React.RefObject<HTMLDivElement | null>;
  colWidths: number[];
  rowHeight: number;
  rowHeaderWidth: number;
  zoomFactor: number;
}> = ({ rows, parentRef, colWidths, rowHeight, rowHeaderWidth, zoomFactor }) => {
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 20,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);

  return (
    <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
      {rowVirtualizer.getVirtualItems().map(virtualRow => {
        const row = rows[virtualRow.index];
        return (
          <div
            key={virtualRow.index}
            className="absolute left-0 top-0 flex border-b border-[#e0e0e0]/70 text-xs"
            style={{
              transform: `translateY(${virtualRow.start}px)`,
              height: rowHeight,
              fontSize: 12 * zoomFactor,
              lineHeight: `${rowHeight}px`,
            }}
          >
            <div
              className="sticky left-0 z-[1] flex shrink-0 items-center justify-center border-r border-[#d8d8d8] bg-[#f7f7f7] text-[11px] text-[#777]"
              style={{ width: rowHeaderWidth, fontSize: 11 * zoomFactor, lineHeight: `${rowHeight}px` }}
            >
              {virtualRow.index + 1}
            </div>
            {row.map((cell, ci) => {
              if (cell.hidden) return null;
              const colSpan = cell.colSpan || 1;
              const rowSpan = cell.rowSpan || 1;
              return (
                <div
                  key={ci}
                  className="flex shrink-0 items-center truncate border-r border-[#e0e0e0]/50 px-2"
                  style={{
                    width: getSpanWidth(colWidths, ci, colSpan, zoomFactor),
                    height: rowHeight * rowSpan,
                    lineHeight: `${rowHeight}px`,
                    paddingLeft: 8 * zoomFactor,
                    paddingRight: 8 * zoomFactor,
                    backgroundColor: cell.bgColor || undefined,
                    color: cell.fontColor || (cell.bgColor ? contrastingTextColor(cell.bgColor) : undefined),
                    fontWeight: cell.bold ? 700 : undefined,
                  }}
                  title={cell.v}
                >
                  {cell.v}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

function startColumnResize(
  event: React.PointerEvent<HTMLDivElement>,
  columnIndex: number,
  startWidth: number,
  zoomFactor: number,
  onColumnResize: (columnIndex: number, width: number) => void,
) {
  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;
  const ownerDocument = event.currentTarget.ownerDocument;
  const previousCursor = ownerDocument.body.style.cursor;
  const previousUserSelect = ownerDocument.body.style.userSelect;
  ownerDocument.body.style.cursor = 'col-resize';
  ownerDocument.body.style.userSelect = 'none';

  const handlePointerMove = (moveEvent: PointerEvent) => {
    onColumnResize(columnIndex, startWidth + (moveEvent.clientX - startX) / zoomFactor);
  };

  const stopResize = () => {
    ownerDocument.removeEventListener('pointermove', handlePointerMove);
    ownerDocument.removeEventListener('pointerup', stopResize);
    ownerDocument.removeEventListener('pointercancel', stopResize);
    ownerDocument.body.style.cursor = previousCursor;
    ownerDocument.body.style.userSelect = previousUserSelect;
  };

  ownerDocument.addEventListener('pointermove', handlePointerMove);
  ownerDocument.addEventListener('pointerup', stopResize);
  ownerDocument.addEventListener('pointercancel', stopResize);
}

function handleColumnResizeKeyDown(
  event: React.KeyboardEvent<HTMLDivElement>,
  columnIndex: number,
  currentWidth: number,
  onColumnResize: (columnIndex: number, width: number) => void,
) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const direction = event.key === 'ArrowRight' ? 1 : -1;
  const step = event.shiftKey ? 20 : 8;
  onColumnResize(columnIndex, currentWidth + direction * step);
}

function getColumnWidths(sheet: Record<string, unknown>, range: { s: { c: number } }, colCount: number): number[] {
  const defaultWidth = getDefaultColumnWidth(colCount);
  const columns = Array.isArray(sheet['!cols']) ? sheet['!cols'] as Array<XlsxColumnInfo | undefined> : [];
  return Array.from({ length: colCount }, (_, index) => {
    const column = columns[range.s.c + index];
    return column ? getColumnWidth(column, defaultWidth) : defaultWidth;
  });
}

function getColumnWidth(column: XlsxColumnInfo, defaultWidth: number): number {
  if (typeof column.wpx === 'number' && Number.isFinite(column.wpx)) {
    return clampColumnWidth(column.wpx);
  }

  const characterWidth = typeof column.wch === 'number' && Number.isFinite(column.wch)
    ? column.wch
    : column.width;
  if (typeof characterWidth === 'number' && Number.isFinite(characterWidth)) {
    return clampColumnWidth(Math.round(characterWidth * 7 + 12));
  }

  return defaultWidth;
}

function getDefaultColumnWidth(colCount: number): number {
  return Math.max(90, Math.min(180, Math.floor(900 / Math.max(colCount, 1))));
}

function clampColumnWidth(width: number): number {
  return Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(width)));
}

function getSpanWidth(colWidths: number[], startColumn: number, colSpan: number, zoomFactor: number): number {
  return colWidths.slice(startColumn, startColumn + colSpan).reduce((sum, width) => sum + width * zoomFactor, 0);
}

function scaleSheetSize(value: number, zoomFactor: number): number {
  return Math.max(1, Math.round(value * zoomFactor));
}

function applyMerges(rows: CellData[][], merges: MergeRange[]) {
  for (const m of merges) {
    if (rows[m.sr]?.[m.sc]) {
      rows[m.sr][m.sc].colSpan = m.ec - m.sc + 1;
      rows[m.sr][m.sc].rowSpan = m.er - m.sr + 1;
    }
    for (let r = m.sr; r <= m.er; r++) {
      for (let c = m.sc; c <= m.ec; c++) {
        if (r === m.sr && c === m.sc) continue;
        if (rows[r]?.[c]) rows[r][c].hidden = true;
      }
    }
  }
}

function contrastingTextColor(bgHex: string): string {
  const hex = bgHex.replace('#', '').slice(-6);
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#383a42' : '#ffffff';
}

function columnName(index: number): string {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const mod = (n - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    n = Math.floor((n - mod) / 26);
  }
  return name;
}
