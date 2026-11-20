import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { CaretDown, Check } from '@phosphor-icons/react';

export interface PremiumSelectOption {
  value: string;
  label: string;
  short?: string;
  group?: string;
  fontFamily?: string;
}

interface PremiumSelectProps {
  value: string;
  options: readonly PremiumSelectOption[];
  onChange(value: string): void;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  title?: string;
  variant?: 'inspector';
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: 'above' | 'below';
}

export function PremiumSelect({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  className,
  title,
  variant,
}: PremiumSelectProps) {
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [position, setPosition] = useState<MenuPosition>({ top: 0, left: 0, width: 0, maxHeight: 280, placement: 'below' });
  const selected = options[selectedIndex] ?? options[0];
  const groupCount = new Set(options.map((option) => option.group).filter(Boolean)).size;

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 7;
    const naturalHeight = Math.min(320, options.length * 43 + groupCount * 27 + 12);
    const below = window.innerHeight - rect.bottom - viewportPadding;
    const above = rect.top - viewportPadding;
    const placeAbove = below < Math.min(210, naturalHeight) && above > below;
    const maxHeight = Math.max(64, Math.min(naturalHeight, placeAbove ? above - gap : below - gap));
    const top = placeAbove
      ? Math.max(viewportPadding, rect.top - maxHeight - gap)
      : Math.min(window.innerHeight - viewportPadding - maxHeight, rect.bottom + gap);
    const width = Math.min(Math.max(rect.width, 230), window.innerWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - viewportPadding - width),
    );
    setPosition({ top, left, width, maxHeight, placement: placeAbove ? 'above' : 'below' });
  }, [options.length, groupCount]);

  function openMenu() {
    if (disabled || options.length === 0) return;
    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    if (option.value !== value) onChange(option.value);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + delta + options.length) % options.length);
      return;
    }
    if (event.key === 'Home' && open) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End' && open) {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      choose(activeIndex);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenu();
    }
  }

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const update = () => updatePosition();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const menuStyle: CSSProperties = {
    top: position.top,
    left: position.left,
    width: position.width,
    maxHeight: position.maxHeight,
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`premium-select-trigger${open ? ' is-open' : ''}${variant ? ` is-${variant}` : ''}${className ? ` ${className}` : ''}`}
        title={title}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span>{selected?.label ?? value}</span>
        <CaretDown size={16} weight="bold" aria-hidden="true" />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          className={`premium-select-menu${variant ? ` is-${variant}` : ''}`}
          data-placement={position.placement}
          role="listbox"
          aria-label={ariaLabel}
          style={menuStyle}
        >
          <div className="premium-select-menu-scroll">
            {options.map((option, index) => (
              <Fragment key={`${option.value}-${index}`}>
                {option.group && (index === 0 || options[index - 1]?.group !== option.group) && (
                  <div className="premium-select-group" aria-hidden="true">{option.group}</div>
                )}
                <button
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  data-index={index}
                  aria-selected={option.value === value}
                  className={`premium-select-option${index === activeIndex ? ' is-active' : ''}${option.value === value ? ' is-selected' : ''}`}
                  onPointerMove={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                  style={option.fontFamily ? { fontFamily: option.fontFamily } : undefined}
                >
                  <span>{option.label}</span>
                  {option.value === value && <Check size={16} weight="bold" aria-hidden="true" />}
                </button>
              </Fragment>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
