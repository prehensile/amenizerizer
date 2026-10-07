# Builds the GBDK-2020 reimplementation of Amenizer.
#
#   make GBDK_HOME=/path/to/gbdk          -> build/amenizer.gb
#   make GBDK_HOME=... SOURCE_ROM=x.gb    -> take the break, tables and rate from x.gb
#   make compare                          -> A/B against SOURCE_ROM in PyBoy
#
# The audio is not in this directory: tools/extract_assets.py lifts the break,
# slice tables and boot rate from SOURCE_ROM (default: the stock cartridge in
# ../resources), so a ROM patched by the web app rebuilds with its own.

GBDK_HOME ?= $(HOME)/gbdk
SOURCE_ROM ?= ../resources/amenizer.gb
PYTHON ?= python3

LCC = $(GBDK_HOME)/bin/lcc
BUILD = build

# -yn sets the header title; no MBC, 32 KiB is GBDK's default. -Wl-m / -Wl-j
# write a map and a .noi symbol file next to the ROM.
LCCFLAGS = -Wl-m -Wl-j -Wm-yn"AMENIZER"

$(BUILD)/amenizer.gb: src/amenizer.c $(BUILD)/assets.s | $(BUILD)
	$(LCC) $(LCCFLAGS) -o $@ src/amenizer.c $(BUILD)/assets.s

$(BUILD)/assets.s: $(SOURCE_ROM) tools/extract_assets.py | $(BUILD)
	$(PYTHON) tools/extract_assets.py $< $@

$(BUILD):
	mkdir -p $@

# Needs `pip install pyboy numpy`. See tools/compare.py for what it checks.
compare: $(BUILD)/amenizer.gb
	$(PYTHON) tools/compare.py $(SOURCE_ROM) $<

clean:
	rm -rf $(BUILD)

.PHONY: clean compare
