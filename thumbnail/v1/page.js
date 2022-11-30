const ne = ['file_input', 'generate', 'picture_preview', 'progress', 'thumbnail', 'upload'].reduce((p, c) => {
  p[c] = document.querySelector(`[data-${c.replace('_', '-')}]`);
  return p;
}, Object.create(null));

ne.generate.disabled = true;
ne.generate.addEventListener('click', generateImg, false);
ne.upload.addEventListener('click', openFileSelector, false);

function generateImg() {
  ne.thumbnail.src = "";
  ne.progress.innerText = "Processing...";
  var canvas = document.createElement('canvas');
  var context = canvas.getContext('2d');
  var img = ne.picture_preview;
  canvas.height = img.naturalHeight;
  canvas.width = img.naturalWidth;
  context.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
  try {
    var data = canvas.toBlob(function(blob) {
      var url = "./thumbnail";
      var xhr = new XMLHttpRequest();
      xhr.responseType = "blob";
      xhr.open("POST", url, true);

      xhr.addEventListener('readystatechange', function(e) {
        if (xhr.readyState == 4 && xhr.status == 200) {
          var reader = new FileReader();
          reader.onload = function() {
            ne.thumbnail.src = reader.result;
            ne.progress.innerText = "";
          }
          reader.readAsDataURL(xhr.response);
        } else if (xhr.readyState == 4) {
          console.log("Error:" + xhr.status);
          var reader = new FileReader();
          reader.onload = function() {
            var b64 = reader.result;
            b64 = b64.substring(b64.indexOf(',') + 1);
            ne.progress.innerText = atob(b64);
          }
          reader.readAsDataURL(xhr.response);
        }
      });
      xhr.send(blob);
    });
  } catch (exp) {
    ne.progress.innerText = exp;
  }
}

function openFileSelector() {
  ne.file_input.click();
}

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

function highlight(e) {
  ne.picture_preview.classList.add('highlight');
}

function unhighlight(e) {
  ne.picture_preview.classList.remove('highlight');
}

function doDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  var items = e.dataTransfer.items;
  var item = items[0];

  var url = e.dataTransfer.getData('URL');
  if (url == "") { url = e.dataTransfer.getData('Text'); }
  if (url != "") {
    ne.picture_preview.src = url;
    ne.generate.disabled = false;
    ne.progress.innerText = "";
  } else {
    previewPicture(e.dataTransfer.files[0]);
  }
}

function previewPicture(file) {
  if (file != null) {
    var reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onloadend = function() {
      ne.picture_preview.src = reader.result;
    }
    ne.generate.disabled = false;
    ne.progress.innerText = "";
  }
}

ne.picture_preview.addEventListener('dragenter', preventDefaults, false);
ne.picture_preview.addEventListener('dragover', preventDefaults, false);
ne.picture_preview.addEventListener('dragleave', preventDefaults, false);

ne.picture_preview.addEventListener('dragenter', highlight, false)
ne.picture_preview.addEventListener('dragover', highlight, false)

ne.picture_preview.addEventListener('dragleave', unhighlight, false)
ne.picture_preview.addEventListener('drop', unhighlight, false)

ne.picture_preview.addEventListener('drop', doDrop, false)
