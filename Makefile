PORT ?= 8795
PY ?= .venv/bin/python
BLENDER ?= blender
B = $(BLENDER) -b --factory-startup --python-exit-code 1
D = web/data
C = build/check

.PHONY: serve setup bake ships $(KINDS) guns castle islands preview frames audio video check clean

# Open http://127.0.0.1:8795/ after this
serve:
	python3 -m http.server $(PORT) --bind 127.0.0.1 --directory web

setup:
	python3 -m venv .venv
	.venv/bin/pip install -r requirements.txt

# Rebuild all baked data: the three warship types and the guns in Blender (textures baked with Cycles), the islands with numpy
bake: ships guns islands castle

KINDS = atake seki kobaya
ships: $(KINDS)

$(KINDS):
	mkdir -p $(C)
	$(B) -P bake/warship.py -- bake $@ $(D) $(C) 4096
	sh tools/webp.sh $(D)/$@_base.png 90
	sh tools/webp.sh $(D)/$@_base_k.png 90
	sh tools/webp.sh $(D)/$@_orm.png 95

guns:
	mkdir -p $(C)
	$(B) -P bake/guns.py -- bake $(D) $(C) 2048
	sh tools/webp.sh $(D)/guns_base.png 90
	sh tools/webp.sh $(D)/guns_orm.png 95
	sh tools/webp.sh $(D)/guns_nrm.png 95

castle:
	mkdir -p $(C)
	$(B) -P bake/castle.py -- bake $(D) $(C) 4096
	sh tools/webp.sh $(D)/castle_base.png 90
	sh tools/webp.sh $(D)/castle_orm.png 95

islands:
	mkdir -p $(C)
	$(PY) bake/islands.py $(D) $(C)

# Check renders (Cycles) of each warship type and the guns, for comparing with the reference pictures
preview:
	for k in $(KINDS); do $(B) -P bake/warship.py -- preview $$k build/preview; done
	$(B) -P bake/guns.py -- preview build/preview

# The film (film.js): about 900 frames at 2x, 20-40 min on an Apple M Mac; resumes if interrupted
frames:
	$(PY) tools/render.py build/frames 0 -1 30

audio: frames
	$(PY) tools/audio.py build/frames build/funaikusa.wav 30

video: audio
	sh tools/encode.sh build/frames build/funaikusa.wav build/funaikusa.mp4

# Syntax check of the Python side
check:
	$(PY) -m pyflakes bake tools

clean:
	rm -rf build
